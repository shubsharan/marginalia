import type { Database } from "bun:sqlite";
import { z } from "zod";
import { LIMITS, type Config } from "./config.ts";
import {
  resolutionInputSchema,
  type ResolutionInput,
  type ResolutionResult,
  type WorkType,
} from "./providers/tmdb.ts";
import { parseRequest, RequestError } from "./errors.ts";

const submissionSchema = z.strictObject({
  inputs: z.array(resolutionInputSchema).min(1).max(LIMITS.maxInputs),
});
const selectionSchema = z.strictObject({
  selections: z
    .array(
      z.strictObject({
        inputId: z.string().min(1).max(128),
        candidateId: z.string().min(1).max(128).nullable(),
      }),
    )
    .min(1)
    .max(LIMITS.maxInputs)
    .refine((choices) => new Set(choices.map((c) => c.inputId)).size === choices.length),
});
type InputRow = {
  id: string;
  request_id: string;
  position: number;
  original_title: string;
  search_title: string;
  year: number | null;
  work_type: WorkType | null;
  resolution_state: string;
  unresolved_reason: string | null;
  selected_candidate_id: string | null;
  selected_at: string | null;
};
type CandidateRow = {
  seq: number;
  id: string;
  input_id: string;
  attempt_id: string;
  ordinal: number;
  provider: "tmdb";
  provider_media_type: "movie" | "tv";
  provider_id: number;
  title: string;
  original_title: string | null;
  work_type: WorkType;
  release_date: string | null;
  original_language: string | null;
  origin_countries: string | null;
  retrieved_at: string;
  eligible: number;
  ineligible_reason: string | null;
  warning_codes: string;
};
type RequestRow = {
  id: string;
  created_at: string;
  frozen_at: string | null;
};
type OperationState = "pending" | "running" | "succeeded" | "failed" | "interrupted";

function requestRow(db: Database, id: string) {
  const row = db.query<RequestRow, [string]>("SELECT * FROM search_requests WHERE id = ?").get(id);
  if (!row) throw new RequestError(404, "not_found", "The request was not found.");
  return row;
}

function capacity(db: Database, requestId?: string) {
  const active = db
    .query<{ count: number; current: number }, [string | null]>(`
    SELECT count(DISTINCT request_id) count, coalesce(max(request_id = ?), 0) current
    FROM operations WHERE state IN ('pending', 'running')
  `)
    .get(requestId ?? null);
  if (active && active.count >= LIMITS.maxActiveRequests && !active.current)
    throw new RequestError(429, "local_capacity", "Local processing capacity is full.");
}

export function submitRequest(db: Database, body: unknown) {
  const { inputs } = parseRequest(submissionSchema, body);
  return db
    .transaction(() => {
      capacity(db);
      const requestId = crypto.randomUUID();
      db.run("INSERT INTO search_requests (id) VALUES (?)", [requestId]);
      for (const [position, input] of inputs.entries()) {
        const inputId = crypto.randomUUID();
        db.run(
          "INSERT INTO title_inputs (id, request_id, position, original_title, search_title, year, work_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            inputId,
            requestId,
            position,
            input.title,
            input.title.trim(),
            input.year ?? null,
            input.workType ?? null,
          ],
        );
        db.run(
          "INSERT INTO operations (id, request_id, kind, input_id) VALUES (?, ?, 'resolution', ?)",
          [crypto.randomUUID(), requestId, inputId],
        );
      }
      return {
        requestId,
        statusUrl: `/v1/search-requests/${requestId}`,
        queuedCount: inputs.length,
      };
    })
    .immediate();
}

function deriveRequestStatus(
  frozen: boolean,
  resolution: { state: OperationState }[],
  searches: { state: OperationState }[],
) {
  const active = (operation: { state: OperationState }) =>
    operation.state === "pending" || operation.state === "running";
  if (resolution.some(active)) return "resolving";
  if (!frozen)
    return resolution.some((o) => o.state === "failed" || o.state === "interrupted")
      ? "blocked"
      : "needs_input";
  if (searches.some(active)) return "searching";
  if (searches.every((o) => o.state === "succeeded")) return "completed";
  if (searches.some((o) => o.state === "succeeded")) return "partial";
  return "failed";
}

export function requestSummary(db: Database, id: string) {
  const request = requestRow(db, id);
  const inputs = db
    .query<InputRow & { work_id: string | null }, [string]>(`
      SELECT i.*, w.id work_id FROM title_inputs i
      LEFT JOIN resolution_candidates c ON c.id = i.selected_candidate_id
      LEFT JOIN works w ON w.provider = c.provider AND w.provider_media_type = c.provider_media_type AND w.provider_id = c.provider_id
      WHERE i.request_id = ? ORDER BY i.position
    `)
    .all(id);
  const operations = db
    .query<
      {
        id: string;
        kind: string;
        state: OperationState;
        input_id: string | null;
        work_id: string | null;
        error_code: string | null;
        retry_at: string | null;
        deadline_at: string | null;
        returned_count: number | null;
        retained_count: number | null;
        rejected_count: number | null;
        limit_flags: string | null;
      },
      [string]
    >(`
    SELECT o.*, a.error_code, a.retry_at, a.deadline_at, a.returned_count, a.retained_count, a.rejected_count, a.limit_flags
    FROM operations o LEFT JOIN operation_attempts a ON a.id = o.current_attempt_id WHERE o.request_id = ? ORDER BY o.seq
  `)
    .all(id)
    .map((o): typeof o => ({
      ...o,
      state:
        o.state === "running" && o.deadline_at !== null && o.deadline_at <= new Date().toISOString()
          ? "interrupted"
          : o.state,
    }));
  const resolution = operations.filter((o) => o.kind === "resolution");
  const searches = operations.filter((o) => o.kind === "search");
  const status = deriveRequestStatus(request.frozen_at !== null, resolution, searches);
  const nextActions = operations
    .filter((o) => ["failed", "interrupted"].includes(o.state))
    .map((o) => ({
      action:
        o.error_code === "provider_credentials"
          ? "configure_credentials"
          : o.error_code === "metadata_policy_missing" || o.error_code === "metadata_restricted"
            ? "review_metadata_policy"
            : o.error_code === "provider_access"
              ? "resolve_provider_access"
              : "retry_operation",
      operationId: o.id,
      inputId: o.input_id,
      workId: o.work_id,
      errorCode: o.error_code ?? (o.state === "interrupted" ? "operation_interrupted" : null),
      retryAt: o.retry_at,
    }));
  for (const input of inputs) {
    if (input.resolution_state === "needs_selection")
      nextActions.push({
        action: "select_candidate",
        operationId: "",
        inputId: input.id,
        workId: null,
        errorCode: null,
        retryAt: null,
      });
    if (input.resolution_state === "unresolved")
      nextActions.push({
        action: "submit_clarified_input",
        operationId: "",
        inputId: input.id,
        workId: null,
        errorCode: null,
        retryAt: null,
      });
  }
  const counts = { pending: 0, running: 0, succeeded: 0, failed: 0, interrupted: 0 };
  for (const operation of operations) {
    counts[operation.state]++;
  }
  return {
    requestId: request.id,
    createdAt: request.created_at,
    frozenAt: request.frozen_at,
    status,
    coverageBounded: true,
    operationCounts: counts,
    distinctWorkCount:
      db
        .query<{ count: number }, [string]>(
          "SELECT count(*) count FROM request_works WHERE request_id = ?",
        )
        .get(id)?.count ?? 0,
    inputs: inputs.map((input) => ({
      id: input.id,
      position: input.position,
      originalTitle: input.original_title,
      title: input.search_title,
      year: input.year,
      workType: input.work_type,
      state:
        resolution.find((o) => o.input_id === input.id)?.state === "interrupted"
          ? "interrupted"
          : input.resolution_state,
      unresolvedReason: input.unresolved_reason,
      selectedCandidateId: input.selected_candidate_id,
      selectedAt: input.selected_at,
      workId: input.work_id,
    })),
    coverage: searches.map((o) => ({
      workId: o.work_id,
      operationId: o.id,
      state:
        o.state === "succeeded" ? (o.retained_count ? "sources_found" : "no_sources") : o.state,
      returnedCount: o.returned_count ?? 0,
      retainedCount: o.retained_count ?? 0,
      rejectedCount: o.rejected_count ?? 0,
      limitFlags: JSON.parse(o.limit_flags ?? "[]"),
    })),
    limitFlags: [
      ...new Set(operations.flatMap((o) => JSON.parse(o.limit_flags ?? "[]") as string[])),
    ],
    nextActions,
  };
}

export function selectCandidates(db: Database, requestId: string, body: unknown) {
  const { selections: choices } = parseRequest(selectionSchema, body);
  return db
    .transaction(() => {
      const request = requestRow(db, requestId);
      if (request.frozen_at)
        throw new RequestError(409, "work_set_frozen", "The selected work set is frozen.");
      const validated = choices.map((choice) => {
        const input = db
          .query<InputRow, [string, string]>(
            "SELECT * FROM title_inputs WHERE id = ? AND request_id = ?",
          )
          .get(choice.inputId, requestId);
        if (!input)
          throw new RequestError(404, "not_found", "The input was not found in this request.");
        const operation = db
          .query<{ state: string; current_attempt_id: string | null }, [string]>(
            "SELECT state, current_attempt_id FROM operations WHERE input_id = ?",
          )
          .get(input.id);
        if (operation?.state !== "succeeded")
          throw new RequestError(
            409,
            "resolution_not_ready",
            "Resolution must succeed before selection.",
          );
        const candidate =
          choice.candidateId === null
            ? null
            : db
                .query<CandidateRow, [string, string]>(
                  "SELECT * FROM resolution_candidates WHERE id = ? AND input_id = ?",
                )
                .get(choice.candidateId, input.id);
        if (choice.candidateId !== null && !candidate)
          throw new RequestError(404, "not_found", "The candidate was not found for this input.");
        if (
          candidate &&
          (!candidate.eligible || candidate.attempt_id !== operation.current_attempt_id)
        )
          throw new RequestError(
            409,
            "candidate_ineligible",
            "The candidate is ineligible or stale.",
          );
        return { input, candidate };
      });
      const willFreeze = db
        .query<InputRow, [string]>("SELECT * FROM title_inputs WHERE request_id = ?")
        .all(requestId)
        .every((input) => {
          const choice = validated.find((v) => v.input.id === input.id);
          return choice ? choice.candidate !== null : input.resolution_state === "resolved";
        });
      if (willFreeze) capacity(db, requestId);
      for (const { input, candidate } of validated) {
        if (!candidate) {
          db.run(
            "UPDATE title_inputs SET resolution_state = 'unresolved', unresolved_reason = 'declined', selected_candidate_id = NULL, selected_at = NULL WHERE id = ?",
            [input.id],
          );
        } else {
          db.run(
            "UPDATE title_inputs SET resolution_state = 'resolved', unresolved_reason = NULL, selected_candidate_id = ?, selected_at = ? WHERE id = ?",
            [candidate.id, new Date().toISOString(), input.id],
          );
          db.run(
            `INSERT INTO works (id, provider, provider_media_type, provider_id, title, original_title, work_type, release_date, original_language, origin_countries, identity_url, retrieved_at)
          VALUES (?, 'tmdb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, provider_media_type, provider_id) DO NOTHING`,
            [
              crypto.randomUUID(),
              candidate.provider_media_type,
              candidate.provider_id,
              candidate.title,
              candidate.original_title,
              candidate.work_type,
              candidate.release_date,
              candidate.original_language,
              candidate.origin_countries,
              `https://www.themoviedb.org/${candidate.provider_media_type}/${candidate.provider_id}`,
              candidate.retrieved_at,
            ],
          );
        }
      }
      if (willFreeze) {
        const selected = db
          .query<{ candidate_id: string; work_id: string }, [string]>(`
        SELECT c.id candidate_id, w.id work_id FROM title_inputs i JOIN resolution_candidates c ON c.id = i.selected_candidate_id
        JOIN works w ON w.provider = c.provider AND w.provider_media_type = c.provider_media_type AND w.provider_id = c.provider_id
        WHERE i.request_id = ? ORDER BY i.position
      `)
          .all(requestId);
        for (const selection of selected) {
          const membership = db.run(
            "INSERT INTO request_works (request_id, work_id, selected_candidate_id) VALUES (?, ?, ?) ON CONFLICT (request_id, work_id) DO NOTHING",
            [requestId, selection.work_id, selection.candidate_id],
          );
          if (membership.changes)
            db.run(
              "INSERT INTO operations (id, request_id, kind, work_id) VALUES (?, ?, 'search', ?)",
              [crypto.randomUUID(), requestId, selection.work_id],
            );
        }
        db.run("UPDATE search_requests SET frozen_at = ? WHERE id = ?", [
          new Date().toISOString(),
          requestId,
        ]);
      }
      return requestSummary(db, requestId);
    })
    .immediate();
}

export type ResolutionAttempt = {
  id: string;
  operationId: string;
  inputId: string;
  input: ResolutionInput;
  deadlineAt: string;
};

export function ownsResolution(db: Database, attempt: ResolutionAttempt) {
  return Boolean(
    db
      .query(`SELECT 1 FROM operations o JOIN operation_attempts a ON a.id = o.current_attempt_id
    WHERE o.id = ? AND o.kind = 'resolution' AND o.input_id = ? AND o.state = 'running' AND a.id = ? AND a.state = 'running' AND a.deadline_at > ?`)
      .get(attempt.operationId, attempt.inputId, attempt.id, new Date().toISOString()),
  );
}

export function publishResolution(
  db: Database,
  attempt: ResolutionAttempt,
  result: ResolutionResult,
) {
  return db
    .transaction(() => {
      if (!ownsResolution(db, attempt)) return false;
      for (const [ordinal, candidate] of result.candidates.entries()) {
        db.run(
          `INSERT INTO resolution_candidates (id, input_id, attempt_id, ordinal, provider, provider_media_type, provider_id, title, original_title, work_type, release_date, original_language, origin_countries, retrieved_at, eligible, ineligible_reason, warning_codes)
        VALUES (?, ?, ?, ?, 'tmdb', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            attempt.inputId,
            attempt.id,
            ordinal,
            candidate.mediaType,
            candidate.providerId,
            candidate.title,
            candidate.originalTitle,
            candidate.workType,
            candidate.releaseDate,
            candidate.originalLanguage,
            candidate.originCountries === null ? null : JSON.stringify(candidate.originCountries),
            candidate.retrievedAt,
            Number(candidate.eligible),
            candidate.ineligibleReason,
            JSON.stringify(candidate.warningCodes),
          ],
        );
      }
      const eligible = result.candidates.some((c) => c.eligible);
      db.run("UPDATE title_inputs SET resolution_state = ?, unresolved_reason = ? WHERE id = ?", [
        eligible ? "needs_selection" : "unresolved",
        eligible ? null : result.candidates.length ? "conflicting_details" : "no_match",
        attempt.inputId,
      ]);
      db.run(
        `UPDATE operation_attempts SET state = 'succeeded', finished_at = ?, returned_count = ?, retained_count = ?, limit_flags = ?, query_context = ? WHERE id = ?`,
        [
          new Date().toISOString(),
          result.returnedCount,
          result.candidates.length,
          JSON.stringify(result.limitFlags),
          JSON.stringify({
            year: attempt.input.year ?? null,
            workType: attempt.input.workType ?? null,
            endpoints: result.endpoints,
            language: "en-US",
            page: 1,
            includeAdult: false,
          }),
          attempt.id,
        ],
      );
      db.run("UPDATE operations SET state = 'succeeded' WHERE id = ?", [attempt.operationId]);
      return true;
    })
    .immediate();
}

export function listCandidates(db: Database, config: Config, requestId: string, inputId: string) {
  requestRow(db, requestId);
  if (
    !db.query("SELECT 1 FROM title_inputs WHERE id = ? AND request_id = ?").get(inputId, requestId)
  )
    throw new RequestError(404, "not_found", "The input was not found in this request.");
  if (!config.providers.tmdb.policy)
    throw new RequestError(503, "metadata_policy_missing", "Review the TMDB metadata policy.");
  const rows = db
    .query<CandidateRow, [string, number]>(`
      SELECT c.* FROM resolution_candidates c JOIN operations o ON o.current_attempt_id = c.attempt_id
      WHERE o.input_id = ? AND c.input_id = o.input_id ORDER BY c.ordinal LIMIT ?
    `)
    .all(inputId, LIMITS.maxCandidates);
  const items = rows.map((row) => ({
    id: row.id,
    inputId: row.input_id,
    attemptId: row.attempt_id,
    ordinal: row.ordinal,
    provider: row.provider,
    providerMediaType: row.provider_media_type,
    providerId: row.provider_id,
    identityUrl: `https://www.themoviedb.org/${row.provider_media_type}/${row.provider_id}`,
    title: row.title,
    originalTitle: row.original_title,
    workType: row.work_type,
    releaseDate: row.release_date,
    originalLanguage: row.original_language,
    originCountries: row.origin_countries === null ? null : JSON.parse(row.origin_countries),
    retrievedAt: row.retrieved_at,
    eligible: Boolean(row.eligible),
    ineligibleReason: row.ineligible_reason,
    warningCodes: JSON.parse(row.warning_codes),
  }));
  const operation = db
    .query<
      {
        query_context: string | null;
        limit_flags: string | null;
        returned_count: number | null;
        retained_count: number | null;
      },
      [string]
    >(
      `SELECT a.query_context, a.limit_flags, a.returned_count, a.retained_count FROM operations o LEFT JOIN operation_attempts a ON a.id = o.current_attempt_id WHERE o.input_id = ?`,
    )
    .get(inputId);
  return {
    items,
    coverageBounded: true,
    limitFlags: JSON.parse(operation?.limit_flags ?? "[]"),
    returnedCount: operation?.returned_count ?? 0,
    retainedCount: operation?.retained_count ?? 0,
    queryContext: JSON.parse(operation?.query_context ?? "{}"),
  };
}
