import type { Database } from "bun:sqlite";
import { LIMITS, type Config } from "./config.ts";
import { resolveTitle, type TmdbFetch, type WorkType } from "./providers/tmdb.ts";
import { searchQuery, searchSources, type SearchFailure } from "./providers/exa.ts";
import {
  ownsResolution,
  ownsSearch,
  publishResolution,
  publishSearch,
  recoverExpired,
  type ResolutionAttempt,
  type SearchAttempt,
} from "./search.ts";

type Attempt = ({ kind: "resolution" } & ResolutionAttempt) | ({ kind: "search" } & SearchAttempt);

export function createWorker({
  db,
  config,
  fetch,
}: {
  db: Database;
  config: Config;
  fetch?: TmdbFetch;
}) {
  let active: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | null = null;
  let stopping = false;

  function claim(): Attempt | null {
    return db
      .transaction(() => {
        const operation = db
          .query<
            {
              id: string;
              kind: "resolution" | "search";
              request_id: string;
              input_id: string | null;
              work_id: string | null;
            },
            []
          >(`
        SELECT * FROM operations WHERE state = 'pending' ORDER BY seq LIMIT 1
      `)
          .get();
        if (!operation) return null;
        const id = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const deadlineAt = new Date(Date.now() + LIMITS.operationTimeoutMs).toISOString();
        const number =
          db
            .query<{ n: number }, [string]>(
              "SELECT coalesce(max(attempt_number), 0) + 1 n FROM operation_attempts WHERE operation_id = ?",
            )
            .get(operation.id)?.n ?? 1;
        let attempt: Attempt;
        let context: unknown;
        if (operation.kind === "resolution") {
          const input = db
            .query<
              { search_title: string; year: number | null; work_type: WorkType | null },
              [string | null]
            >("SELECT search_title, year, work_type FROM title_inputs WHERE id = ?")
            .get(operation.input_id);
          if (!input || !operation.input_id) throw new Error("Resolution input was not found.");
          attempt = {
            kind: "resolution",
            id,
            operationId: operation.id,
            inputId: operation.input_id,
            deadlineAt,
            input: {
              title: input.search_title,
              ...(input.year === null ? {} : { year: input.year }),
              ...(input.work_type === null ? {} : { workType: input.work_type }),
            },
          };
          context = {
            year: input.year,
            workType: input.work_type,
            language: "en-US",
            page: 1,
            includeAdult: false,
          };
        } else {
          const selection = db
            .query<
              { title: string; release_date: string | null; work_type: WorkType },
              [string, string | null]
            >(`SELECT c.title, c.release_date, c.work_type FROM request_works rw
            JOIN resolution_candidates c ON c.id = rw.selected_candidate_id JOIN search_requests r ON r.id = rw.request_id
            WHERE rw.request_id = ? AND rw.work_id = ? AND r.frozen_at IS NOT NULL`)
            .get(operation.request_id, operation.work_id);
          if (!selection || !operation.work_id)
            throw new Error("Frozen work selection was not found.");
          attempt = {
            kind: "search",
            id,
            operationId: operation.id,
            requestId: operation.request_id,
            workId: operation.work_id,
            deadlineAt,
            selection: {
              title: selection.title,
              releaseDate: selection.release_date,
              workType: selection.work_type,
            },
          };
          context = { workId: operation.work_id, type: "auto", numResults: 20 };
        }
        db.run(
          `INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, query_context, template_version, started_at, deadline_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            operation.id,
            number,
            attempt.kind === "resolution" ? "tmdb" : "exa",
            attempt.kind === "resolution" ? attempt.input.title : searchQuery(attempt.selection),
            JSON.stringify(context),
            attempt.kind === "resolution" ? "tmdb-search-v1" : "exa-search-v1",
            startedAt,
            deadlineAt,
          ],
        );
        db.run("UPDATE operations SET state = 'running', current_attempt_id = ? WHERE id = ?", [
          id,
          operation.id,
        ]);
        if (attempt.kind === "resolution")
          db.run(
            "UPDATE title_inputs SET resolution_state = 'running', unresolved_reason = NULL WHERE id = ?",
            [attempt.inputId],
          );
        return attempt;
      })
      .immediate();
  }

  function fail(
    attempt: Attempt,
    failure: {
      code: SearchFailure["code"] | "operation_interrupted" | "storage_unavailable";
      retryAt: string | null;
    },
    interrupted: boolean,
  ) {
    db.transaction(() => {
      if (!(attempt.kind === "resolution" ? ownsResolution(db, attempt) : ownsSearch(db, attempt)))
        return;
      const state = interrupted ? "interrupted" : "failed";
      db.run(
        "UPDATE operation_attempts SET state = ?, finished_at = ?, error_code = ?, retry_at = ? WHERE id = ?",
        [state, new Date().toISOString(), failure.code, failure.retryAt, attempt.id],
      );
      db.run("UPDATE operations SET state = ? WHERE id = ?", [state, attempt.operationId]);
      if (attempt.kind === "resolution")
        db.run("UPDATE title_inputs SET resolution_state = ? WHERE id = ?", [
          state,
          attempt.inputId,
        ]);
    }).immediate();
  }

  async function perform() {
    const attempt = claim();
    if (!attempt) return false;
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(Math.max(1, Date.parse(attempt.deadlineAt) - Date.now())),
    ]);
    try {
      if (attempt.kind === "resolution") {
        const result = await resolveTitle({
          input: attempt.input,
          provider: config.providers.tmdb,
          fetch,
          signal,
        });
        if (signal.aborted) fail(attempt, { code: "operation_interrupted", retryAt: null }, true);
        else if (result.isErr()) fail(attempt, result.error, false);
        else publishResolution(db, attempt, result.value);
      } else {
        const result = await searchSources({
          selection: attempt.selection,
          provider: config.providers.exa,
          fetch,
          signal,
        });
        if (signal.aborted) fail(attempt, { code: "operation_interrupted", retryAt: null }, true);
        else if (result.isErr()) fail(attempt, result.error, false);
        else publishSearch(db, attempt, result.value);
      }
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "SQLiteError") throw error;
      fail(attempt, { code: "storage_unavailable", retryAt: null }, false);
    } finally {
      controller = null;
    }
    return true;
  }

  async function runOnce(): Promise<boolean> {
    if (stopping) return false;
    recoverExpired(db);
    if (active) return false;
    active = perform().finally(() => {
      active = null;
    });
    return active;
  }

  function tick() {
    void runOnce().catch(() => {
      stopping = true;
      clearInterval(timer);
      process.stderr.write(
        JSON.stringify({
          level: "error",
          code: "storage_unavailable",
          component: "search_worker",
        }) + "\n",
      );
    });
  }

  return {
    runOnce,
    start() {
      if (timer || stopping) return;
      timer = setInterval(tick, LIMITS.recoveryIntervalMs);
      tick();
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      controller?.abort();
      await active;
      recoverExpired(db);
    },
  };
}
