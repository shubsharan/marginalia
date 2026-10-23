# Local search API

JSON API at `http://127.0.0.1:4310`. Phase 3 implements health, submission, request summary,
candidate listing, and selection routes. The remaining routes are planned. Final selection queues
search operations; Phase 4 adds their execution. Public hosting and the full knowledge-query API are
outside this feature.

Hono routes requests through shared access checks; Zod schemas validate boundary data. Validation
responses expose field paths and local codes, never raw library errors or input values. Internal
provider results do not change this JSON contract or SQLite rollback semantics.

## Access and configuration

Bind only loopback. Validate Host against the configured loopback address/port. Reject browser
Origin headers and cross-site requests; provide no CORS grant. Mutations require `application/json`.
Read methods and other non-mutation methods reject bodies with `400 body_not_allowed`, including
declared and streamed bodies. Return JSON as data, never HTML. This interface trusts the local
machine and has no public accounts.

| Configuration            | Behavior                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `MARGINALIA_DB_PATH`     | Defaults to `apps/search/data/search.sqlite`, resolved from the app directory regardless of launch directory |
| `EXA_API_KEY`            | Required for Exa execution only; never serialized/logged                                                     |
| `TMDB_READ_ACCESS_TOKEN` | TMDB API Read Access Token sent only in the Authorization header; required for live resolution               |
| `metadata-policy.json`   | Reviewed provider approval for the fixed metadata contract, per [providers.md](providers.md)                 |

Missing credentials fail affected provider operations but do not block saved reads. Missing or
invalid metadata approval blocks calls and metadata reads for that provider with
`metadata_policy_missing`; metadata reads return 503. Local IDs, original inputs, selections,
counts, and status remain readable. Storage/migration failure prevents readiness and startup. Health
reports storage and provider configuration separately, without secret values. Database failure never
returns success.

`GET /health` returns `storage.ready` and per-provider entries under `providers.tmdb` and
`providers.exa`. Each entry contains `credentialsConfigured`, `metadataPolicyReady`, `ready`, and
`reasons`. Reasons use `provider_credentials` and `metadata_policy_missing`; these flags report
local configuration, not verified provider access or legal permission. Startup requires explicit
migration before opening storage and checks version/checksum compatibility and SQLite integrity. It
does not inventory individual columns or triggers. Later storage failures return a safe 503 error.

## Limits and pagination

Accept a JSON body up to 16 KiB with 1-20 inputs. A title must have 1-300 trimmed characters;
preserve the original submitted title. Optional `year` is an integer from 1800-2200. Optional
`workType` is `film` or `television_series`. Reject null optional values, unknown fields, and wrong
types with input-specific errors. Validate the whole request before writes/provider calls.

Resolve at most 20 candidates/input and search at most 20 results/distinct work. Allow at most 20
requests with pending/running operations; submissions, retries, and final selections that exceed
this limit fail before mutation with `429 local_capacity`.

Candidate lists accept no query parameters and return the current attempt's candidates in ordinal
order, capped at 20. An attempt without published candidates returns `items: []`. Historical
candidates remain stored internally. Responses keep query context, returned/retained counts,
`coverageBounded`, and limit flags; they omit `nextCursor` and `snapshotAt`. Query parameters return
`400 invalid_query`.

Planned growing lists accept `limit` from 1-100, default 25, and an optional cursor. Return `items`,
`nextCursor` or null, and `snapshotAt`. Cursor scope includes endpoint/filter, maximum row sequence,
and last sequence. Reject malformed/mismatched cursors with 400. Pagination reads saved rows only.
New traversals include later inserts. Embedded input/work summaries are bounded by the submission
limit; source observations use pagination. Internal byte, timeout, and scheduling thresholds are
implementation defaults in `src/config.ts`, not request-level configuration snapshots.

## Endpoints

| Method/path                                              | Request                                                       | Success                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`                                            | None                                                          | `200` storage readiness and provider configuration flags                    |
| `POST /v1/search-requests`                               | `{"inputs":[{"title":"Heat","year":1995,"workType":"film"}]}` | `202` requestId, statusUrl, queued count                                    |
| `GET /v1/search-requests`                                | Pagination                                                    | `200` saved summaries                                                       |
| `GET /v1/search-requests/:id`                            | None                                                          | `200` ordered inputs, selected IDs, counts, per-work coverage, next actions |
| `GET /v1/search-requests/:id/inputs/:inputId/candidates` | None                                                          | `200` candidate metadata, eligibility, provenance, limits                   |
| `POST /v1/search-requests/:id/selections`                | `{"selections":[{"inputId":"...","candidateId":"..."}]}`      | `200` summary; final selection also queues search                           |
| `GET /v1/search-requests/:id/works`                      | Pagination                                                    | `200` selected works, input mappings, selection snapshots                   |
| `GET /v1/search-requests/:id/sources`                    | Pagination, optional workId                                   | `200` one row/source with matching work IDs and observation links           |
| `POST /v1/search-requests/:id/retry`                     | operationIds array or `{}`                                    | `202` queued IDs, or `200` empty list if none qualify                       |
| `GET /v1/works/:id`                                      | None                                                          | `200` stable identity and first-selected metadata provenance                |
| `GET /v1/sources/:id`                                    | None                                                          | `200` identity/location, unknown content rights, observations URL           |
| `GET /v1/sources/:id/observations`                       | Pagination, optional requestId                                | `200` metadata with query/rank/time and request/work associations           |

Operation-list, attempt-history, and rejection-history endpoints are deferred. Request summaries
provide affected operation IDs, safe failures, counts, retry times, and next actions. Attempt and
rejection records remain internal; source observations retain query/rank/time provenance.

Selection batches contain 1-20 unique input IDs; `candidateId: null` means decline. Validate all
ownership and eligibility before mutation. One invalid choice rejects the whole batch. The final
selection freezes memberships and queues search atomically. Frozen selections cannot change.

Retry arrays contain at most 20 unique operation IDs in this request. Explicit succeeded, active, or
not-yet-due operations produce `409 operation_not_retryable` without changes. `{}` selects only due
failed/interrupted operations. Unknown IDs return 404. Repeated retry requests never restart
completed work. Configuration must be corrected before an affected retry can succeed.

## Response meaning

Request status is `resolving`, `needs_input`, `blocked`, `searching`, `completed`, `partial`, or
`failed`, per the [model](../data-model.md). Summaries include freeze time, input states,
distinct-work count, operation counts by state, per-work coverage, `coverageBounded: true`, limit
flags, and next actions with affected operation IDs, safe errors, and retry times. The `limits`
property is removed; query provenance remains stored with attempts.

Candidates include distinguishing details, TMDB media type/ID, provider identity URL, retrieval
time, and eligibility. Work references remain local UUIDs; no provider revision is invented.
Candidate search excludes adult results and exposes bounded coverage. Missing values are null.
Source output uses `kind: "source_candidate"`, `relevanceVerified: false`, stable IDs, nullable
metadata, and provenance links. Each observation exposes query, rank, provider, time, request ID,
and safe notices joined from its saved attempt. Source-content `processingPermission` and
`displayPermission` remain `unknown`. Missing approval blocks the whole provider metadata read
rather than suppressing individual fields.

Completed searches can have `no_sources`; show rejection counts separately from provider-empty
results. Completion means the bounded search plan finished, not that every source is relevant or all
sources were found. Saved reads make no provider calls.

## Errors and atomicity

Errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`. Details contain
validated field paths or local IDs, never credentials, raw payloads, or provider exception text.

| Status  | Meaning                                                                |
| ------- | ---------------------------------------------------------------------- |
| 400     | Malformed JSON/cursor/query                                            |
| 403     | Host/origin rejection                                                  |
| 404     | Unknown or out-of-scope record                                         |
| 409     | Frozen set, ineligible/stale choice, retry timing or state conflict    |
| 413/415 | Oversized body/unsupported content type                                |
| 422     | Invalid submission/selection fields                                    |
| 429     | Local capacity reached                                                 |
| 500/503 | Internal/storage failure or metadata-policy read gate with a safe code |

Provider failures after acceptance remain saved operation outcomes. Reading that failure returns 200
when the record is readable. Database errors roll back the current mutation and preserve prior
commits. Repeated submission POSTs create separate requests and can incur new provider calls; shared
work/source identities are reused. No submission deduplication token is introduced.
