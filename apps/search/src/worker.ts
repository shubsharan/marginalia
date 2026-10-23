import type { Database } from "bun:sqlite";
import { LIMITS, type Config } from "./config.ts";
import {
  resolveTitle,
  type ProviderFailure,
  type TmdbFetch,
  type WorkType,
} from "./providers/tmdb.ts";
import { ownsResolution, publishResolution, type ResolutionAttempt } from "./search.ts";

export function createResolutionWorker({
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

  function claim(): ResolutionAttempt | null {
    return db
      .transaction(() => {
        const operation = db
          .query<
            {
              id: string;
              input_id: string;
              search_title: string;
              year: number | null;
              work_type: WorkType | null;
            },
            []
          >(`
        SELECT o.id, o.input_id, i.search_title, i.year, i.work_type FROM operations o
        JOIN title_inputs i ON i.id = o.input_id WHERE o.state = 'pending' AND o.kind = 'resolution' ORDER BY o.seq LIMIT 1
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
        const input = {
          title: operation.search_title,
          ...(operation.year === null ? {} : { year: operation.year }),
          ...(operation.work_type === null ? {} : { workType: operation.work_type }),
        };
        db.run(
          `INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, query_context, template_version, started_at, deadline_at)
        VALUES (?, ?, ?, 'tmdb', ?, ?, 'tmdb-search-v1', ?, ?)`,
          [
            id,
            operation.id,
            number,
            input.title,
            JSON.stringify({
              year: input.year ?? null,
              workType: input.workType ?? null,
              language: "en-US",
              page: 1,
              includeAdult: false,
            }),
            startedAt,
            deadlineAt,
          ],
        );
        db.run("UPDATE operations SET state = 'running', current_attempt_id = ? WHERE id = ?", [
          id,
          operation.id,
        ]);
        db.run(
          "UPDATE title_inputs SET resolution_state = 'running', unresolved_reason = NULL WHERE id = ?",
          [operation.input_id],
        );
        return { id, operationId: operation.id, inputId: operation.input_id, input, deadlineAt };
      })
      .immediate();
  }

  function fail(
    attempt: ResolutionAttempt,
    failure: {
      code: ProviderFailure["code"] | "operation_interrupted" | "storage_unavailable";
      retryAt: string | null;
    },
    interrupted: boolean,
  ) {
    db.transaction(() => {
      if (!ownsResolution(db, attempt)) return;
      const state = interrupted ? "interrupted" : "failed";
      db.run(
        "UPDATE operation_attempts SET state = ?, finished_at = ?, error_code = ?, retry_at = ? WHERE id = ?",
        [state, new Date().toISOString(), failure.code, failure.retryAt, attempt.id],
      );
      db.run("UPDATE operations SET state = ? WHERE id = ?", [state, attempt.operationId]);
      db.run("UPDATE title_inputs SET resolution_state = ? WHERE id = ?", [state, attempt.inputId]);
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
      const result = await resolveTitle({
        input: attempt.input,
        provider: config.providers.tmdb,
        fetch,
        signal,
      });
      if (signal.aborted) fail(attempt, { code: "operation_interrupted", retryAt: null }, true);
      else if (result.isErr()) fail(attempt, result.error, false);
      else publishResolution(db, attempt, result.value);
    } catch {
      fail(attempt, { code: "storage_unavailable", retryAt: null }, false);
    } finally {
      controller = null;
    }
    return true;
  }

  function runOnce(): Promise<boolean> {
    if (stopping || active) return Promise.resolve(false);
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
          component: "resolution_worker",
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
    },
  };
}
