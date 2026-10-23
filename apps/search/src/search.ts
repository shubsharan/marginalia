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
import type { SearchResult, SearchSelection } from "./providers/exa.ts";

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

const retrySchema = z.strictObject({
  operationIds: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(LIMITS.maxInputs)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});

export function recoverExpired(db: Database) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `UPDATE title_inputs SET resolution_state = 'interrupted' WHERE id IN (
      SELECT o.input_id FROM operations o JOIN operation_attempts a ON a.id = o.current_attempt_id
      WHERE o.state = 'running' AND a.state = 'running' AND a.deadline_at <= ?
    )`,
      [now],
    );
    db.run(
      `UPDATE operation_attempts SET state = 'interrupted', finished_at = ?, error_code = 'operation_interrupted', retry_at = NULL
      WHERE state = 'running' AND deadline_at <= ? AND id IN (
        SELECT current_attempt_id FROM operations WHERE state = 'running'
      )`,
      [now, now],
    );
    db.run(
      `UPDATE operations SET state = 'interrupted' WHERE state = 'running' AND current_attempt_id IN (
      SELECT id FROM operation_attempts WHERE state = 'interrupted' AND deadline_at <= ?
    )`,
      [now],
    );
  }).immediate();
}

export function retryOperations(db: Database, requestId: string, body: unknown) {
  const { operationIds } = parseRequest(retrySchema, body);
  return db
    .transaction(() => {
      requestRow(db, requestId);
      const now = new Date().toISOString();
      const operations = db
        .query<
          {
            id: string;
            input_id: string | null;
            state: OperationState;
            retry_at: string | null;
            deadline_at: string | null;
          },
          [string]
        >(`SELECT o.id, o.input_id, o.state, a.retry_at, a.deadline_at FROM operations o
      LEFT JOIN operation_attempts a ON a.id = o.current_attempt_id WHERE o.request_id = ? ORDER BY o.seq`)
        .all(requestId);
      const due = (o: (typeof operations)[number]) =>
        (o.state === "failed" ||
          o.state === "interrupted" ||
          (o.state === "running" && o.deadline_at !== null && o.deadline_at <= now)) &&
        (o.retry_at === null || o.retry_at <= now);
      if (operationIds) {
        for (const id of operationIds) {
          const operation = operations.find((o) => o.id === id);
          if (!operation)
            throw new RequestError(
              404,
              "not_found",
              "The operation was not found in this request.",
            );
          if (!due(operation))
            throw new RequestError(
              409,
              "operation_not_retryable",
              "The operation is active, completed, or not yet due.",
              [id],
            );
        }
      }
      const selected = operations.filter((o) =>
        operationIds ? operationIds.includes(o.id) : due(o),
      );
      if (selected.length) {
        capacity(db, requestId);
        recoverExpired(db);
        for (const operation of selected) {
          db.run("UPDATE operations SET state = 'pending' WHERE id = ?", [operation.id]);
          if (operation.input_id)
            db.run(
              "UPDATE title_inputs SET resolution_state = 'pending', unresolved_reason = NULL WHERE id = ?",
              [operation.input_id],
            );
        }
      }
      return { queuedOperationIds: selected.map((o) => o.id) };
    })
    .immediate();
}

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
            : o.error_code === "provider_budget"
              ? "restore_provider_credits"
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
    creditsUrl: "/credits",
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

export type SearchAttempt = {
  id: string;
  operationId: string;
  requestId: string;
  workId: string;
  selection: SearchSelection;
  deadlineAt: string;
};

export function ownsSearch(db: Database, attempt: SearchAttempt) {
  return Boolean(
    db
      .query(`
    SELECT 1 FROM operations o JOIN operation_attempts a ON a.id = o.current_attempt_id
    JOIN request_works rw ON rw.request_id = o.request_id AND rw.work_id = o.work_id
    JOIN search_requests r ON r.id = o.request_id
    WHERE o.id = ? AND o.kind = 'search' AND o.request_id = ? AND o.work_id = ?
      AND r.frozen_at IS NOT NULL AND o.state = 'running' AND a.id = ?
      AND a.state = 'running' AND a.deadline_at > ?
  `)
      .get(
        attempt.operationId,
        attempt.requestId,
        attempt.workId,
        attempt.id,
        new Date().toISOString(),
      ),
  );
}

export function publishSearch(db: Database, attempt: SearchAttempt, result: SearchResult) {
  return db
    .transaction(() => {
      if (!ownsSearch(db, attempt)) return false;
      for (const source of result.sources) {
        db.run(
          "INSERT INTO sources (id, normalized_url, source_host) VALUES (?, ?, ?) ON CONFLICT (normalized_url) DO NOTHING",
          [crypto.randomUUID(), source.normalizedUrl, source.sourceHost],
        );
        const identity = db
          .query<{ id: string }, [string]>("SELECT id FROM sources WHERE normalized_url = ?")
          .get(source.normalizedUrl);
        if (!identity) throw new Error("Source identity was not saved.");
        db.run(
          "INSERT INTO search_records (id, request_id, work_id, source_id) VALUES (?, ?, ?, ?) ON CONFLICT (request_id, work_id, source_id) DO NOTHING",
          [crypto.randomUUID(), attempt.requestId, attempt.workId, identity.id],
        );
        const record = db
          .query<{ id: string }, [string, string, string]>(
            "SELECT id FROM search_records WHERE request_id = ? AND work_id = ? AND source_id = ?",
          )
          .get(attempt.requestId, attempt.workId, identity.id);
        if (!record) throw new Error("Source association was not saved.");
        db.run(
          `INSERT INTO source_observations
        (id, search_record_id, attempt_id, provider_result_id, ordinal, original_url, title, author, publisher, publication_date, observed_at, metadata_policy_revision, warning_codes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            record.id,
            attempt.id,
            source.providerResultId,
            source.ordinal,
            source.originalUrl,
            source.title,
            source.author,
            source.publisher,
            source.publicationDate,
            source.observedAt,
            result.metadataPolicyRevision,
            JSON.stringify(source.warningCodes),
          ],
        );
      }
      for (const rejection of result.rejections)
        db.run(
          "INSERT INTO rejected_results (id, attempt_id, ordinal, reason_code) VALUES (?, ?, ?, ?)",
          [crypto.randomUUID(), attempt.id, rejection.ordinal, rejection.reasonCode],
        );
      db.run(
        `UPDATE operation_attempts SET state = 'succeeded', finished_at = ?, provider_request_id = ?, returned_count = ?, retained_count = ?, rejected_count = ?, limit_flags = ?, notice_codes = ? WHERE id = ?`,
        [
          new Date().toISOString(),
          result.providerRequestId,
          result.returnedCount,
          result.sources.length,
          result.rejections.length,
          JSON.stringify(result.limitFlags),
          JSON.stringify(result.noticeCodes),
          attempt.id,
        ],
      );
      db.run("UPDATE operations SET state = 'succeeded' WHERE id = ?", [attempt.operationId]);
      return true;
    })
    .immediate();
}

const cursorSchema = z
  .strictObject({
    scope: z.string(),
    max: z.int().nonnegative(),
    last: z.int().nonnegative(),
    snapshotAt: z.iso.datetime(),
  })
  .refine((cursor) => cursor.last <= cursor.max);

function pagination(query: URLSearchParams, scope: string, filter?: "workId" | "requestId") {
  const allowed = new Set(["limit", "cursor", ...(filter ? [filter] : [])]);
  for (const key of query.keys())
    if (!allowed.has(key) || query.getAll(key).length !== 1)
      throw new RequestError(400, "invalid_query", "Invalid query parameters.");
  const limit = query.get("limit") ?? "25";
  if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100)
    throw new RequestError(400, "invalid_query", "Limit must be between 1 and 100.");
  const encoded = query.get("cursor");
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (encoded !== null) {
    let value: unknown;
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(encoded)) throw new SyntaxError();
      value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new RequestError(400, "invalid_cursor", "Invalid pagination cursor.");
    }
    const parsed = cursorSchema.safeParse(value);
    if (!parsed.success || parsed.data.scope !== scope)
      throw new RequestError(400, "invalid_cursor", "The cursor does not match this list.");
    cursor = parsed.data;
  }
  return { limit: Number(limit), cursor };
}

function page<T extends { seq: number }>(
  db: Database,
  query: URLSearchParams,
  scope: string,
  sql: string,
  params: string[] = [],
  filter?: "workId" | "requestId",
) {
  const { limit, cursor } = pagination(query, scope, filter);
  const max =
    cursor?.max ??
    db
      .query<{ max: number }, string[]>(`SELECT coalesce(max(seq), 0) max FROM (${sql})`)
      .get(...params)?.max ??
    0;
  const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString();
  const rows = db
    .query<T, (string | number)[]>(
      `SELECT * FROM (${sql}) WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?`,
    )
    .all(...params, cursor?.last ?? 0, max, limit + 1);
  return pageResult(rows, limit, scope, max, snapshotAt);
}

function pageResult<T extends { seq: number }>(
  rows: T[],
  limit: number,
  scope: string,
  max: number,
  snapshotAt: string,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    snapshotAt,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ scope, max, last: last.seq, snapshotAt })).toString(
            "base64url",
          )
        : null,
  };
}

function requireApproval(config: Config, provider: "tmdb" | "exa") {
  if (!config.providers[provider].policy)
    throw new RequestError(
      503,
      "metadata_policy_missing",
      `Review the ${provider} metadata policy.`,
    );
}

function workMetadata(row: CandidateRow | WorkRow) {
  return {
    provider: row.provider,
    providerMediaType: row.provider_media_type,
    providerId: row.provider_id,
    identityUrl: `https://www.themoviedb.org/${row.provider_media_type}/${row.provider_id}`,
    creditsUrl: "/credits",
    title: row.title,
    originalTitle: row.original_title,
    workType: row.work_type,
    releaseDate: row.release_date,
    originalLanguage: row.original_language,
    originCountries: row.origin_countries === null ? null : JSON.parse(row.origin_countries),
    retrievedAt: row.retrieved_at,
  };
}

type WorkRow = Pick<
  CandidateRow,
  | "seq"
  | "id"
  | "provider"
  | "provider_media_type"
  | "provider_id"
  | "title"
  | "original_title"
  | "work_type"
  | "release_date"
  | "original_language"
  | "origin_countries"
  | "retrieved_at"
>;

export function listRequests(db: Database, query: URLSearchParams) {
  const result = page<RequestRow & { seq: number }>(
    db,
    query,
    "requests",
    "SELECT * FROM search_requests",
  );
  return { ...result, items: result.items.map((row) => requestSummary(db, row.id)) };
}

export function workDetail(db: Database, config: Config, id: string) {
  const row = db.query<WorkRow, [string]>("SELECT * FROM works WHERE id = ?").get(id);
  if (!row) throw new RequestError(404, "not_found", "The work was not found.");
  requireApproval(config, "tmdb");
  return { id: row.id, ...workMetadata(row) };
}

export function listWorks(db: Database, config: Config, requestId: string, query: URLSearchParams) {
  requestRow(db, requestId);
  requireApproval(config, "tmdb");
  const result = page<WorkRow & { work_id: string }>(
    db,
    query,
    `works:${requestId}`,
    `SELECT rw.seq, rw.work_id, c.id, c.provider, c.provider_media_type, c.provider_id, c.title, c.original_title, c.work_type, c.release_date, c.original_language, c.origin_countries, c.retrieved_at FROM request_works rw JOIN resolution_candidates c ON c.id = rw.selected_candidate_id WHERE rw.request_id = ?`,
    [requestId],
  );
  const inputs = requestSummary(db, requestId).inputs;
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.work_id,
      selectedCandidateId: row.id,
      selectionSnapshot: workMetadata(row),
      inputIds: inputs.filter((input) => input.workId === row.work_id).map((input) => input.id),
    })),
  };
}

type SourceRow = {
  seq: number;
  id: string;
  normalized_url: string;
  source_host: string;
  processing_permission: "unknown";
  display_permission: "unknown";
};

function sourceMetadata(row: SourceRow) {
  return {
    id: row.id,
    kind: "source_candidate",
    relevanceVerified: false,
    url: row.normalized_url,
    sourceHost: row.source_host,
    processingPermission: row.processing_permission,
    displayPermission: row.display_permission,
    observationsUrl: `/v1/sources/${row.id}/observations`,
  };
}

function sourceRow(db: Database, id: string) {
  const row = db.query<SourceRow, [string]>("SELECT * FROM sources WHERE id = ?").get(id);
  if (!row) throw new RequestError(404, "not_found", "The source was not found.");
  return row;
}

export function sourceDetail(db: Database, config: Config, id: string) {
  const row = sourceRow(db, id);
  requireApproval(config, "exa");
  return sourceMetadata(row);
}

export function listSources(
  db: Database,
  config: Config,
  requestId: string,
  query: URLSearchParams,
) {
  requestRow(db, requestId);
  requireApproval(config, "exa");
  const workId = query.get("workId");
  const scope = `sources:${requestId}:${workId ?? ""}`;
  const { limit, cursor } = pagination(query, scope, "workId");
  if (
    workId !== null &&
    !db
      .query("SELECT 1 FROM request_works WHERE request_id = ? AND work_id = ?")
      .get(requestId, workId)
  )
    throw new RequestError(404, "not_found", "The selected work was not found in this request.");
  const max =
    cursor?.max ??
    db
      .query<{ max: number }, [string]>(
        "SELECT coalesce(max(seq), 0) max FROM search_records WHERE request_id = ?",
      )
      .get(requestId)?.max ??
    0;
  const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString();
  const rows = db
    .query<SourceRow, (string | number)[]>(`
    SELECT min(r.seq) seq, s.id, s.normalized_url, s.source_host, s.processing_permission, s.display_permission
    FROM sources s JOIN search_records r ON r.source_id = s.id
    WHERE r.request_id = ? AND r.seq <= ?${workId === null ? "" : " AND r.work_id = ?"}
    GROUP BY s.id HAVING min(r.seq) > ? ORDER BY seq LIMIT ?
  `)
    .all(requestId, max, ...(workId === null ? [] : [workId]), cursor?.last ?? 0, limit + 1);
  const result = pageResult(rows, limit, scope, max, snapshotAt);
  return {
    ...result,
    items: result.items.map((row) => ({
      ...sourceMetadata(row),
      workIds: db
        .query<{ work_id: string }, [string, string, number]>(
          "SELECT work_id FROM search_records WHERE request_id = ? AND source_id = ? AND seq <= ? ORDER BY seq",
        )
        .all(requestId, row.id, max)
        .map((r) => r.work_id),
      observationsUrl: `/v1/sources/${row.id}/observations?requestId=${requestId}`,
    })),
  };
}

type ObservationRow = {
  seq: number;
  id: string;
  original_url: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publication_date: string | null;
  observed_at: string;
  ordinal: number;
  metadata_policy_revision: string;
  warning_codes: string;
  request_id: string;
  work_id: string;
  attempt_id: string;
  query: string;
  provider: "exa";
  template_version: string;
  provider_request_id: string | null;
  notice_codes: string;
};

export function listObservations(
  db: Database,
  config: Config,
  sourceId: string,
  query: URLSearchParams,
) {
  sourceRow(db, sourceId);
  requireApproval(config, "exa");
  const requestId = query.get("requestId");
  if (requestId !== null) requestRow(db, requestId);
  const result = page<ObservationRow>(
    db,
    query,
    `observations:${sourceId}:${requestId ?? ""}`,
    `SELECT ob.*, r.request_id, r.work_id, a.query, a.provider, a.template_version, a.provider_request_id, a.notice_codes
    FROM source_observations ob JOIN search_records r ON r.id = ob.search_record_id JOIN operation_attempts a ON a.id = ob.attempt_id
    WHERE r.source_id = ?${requestId === null ? "" : " AND r.request_id = ?"}`,
    requestId === null ? [sourceId] : [sourceId, requestId],
    "requestId",
  );
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id,
      sourceId,
      requestId: row.request_id,
      workId: row.work_id,
      attemptId: row.attempt_id,
      url: row.original_url,
      title: row.title,
      author: row.author,
      publisher: row.publisher,
      publicationDate: row.publication_date,
      observedAt: row.observed_at,
      rank: row.ordinal + 1,
      query: row.query,
      provider: row.provider,
      templateVersion: row.template_version,
      providerRequestId: row.provider_request_id,
      metadataPolicyRevision: row.metadata_policy_revision,
      warningCodes: JSON.parse(row.warning_codes),
      noticeCodes: JSON.parse(row.notice_codes),
      kind: "source_candidate",
      relevanceVerified: false,
    })),
  };
}
