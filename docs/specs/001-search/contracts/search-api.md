# Local search API

Planned JSON API at `http://127.0.0.1:4310`. No routes exist yet. Public hosting and the full
knowledge-query API are outside this feature.

## Access and configuration

Bind only loopback. Validate Host against the configured loopback address/port. Reject browser
Origin headers and cross-site requests; provide no CORS grant. Mutations require `application/json`.
Return JSON as data, never HTML. This interface trusts the local machine and has no public accounts.

| Configuration            | Behavior                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `MARGINALIA_DB_PATH`     | Defaults to `apps/search/data/search.sqlite`, resolved from the app directory regardless of launch directory |
| `EXA_API_KEY`            | Required for Exa execution only; never serialized/logged                                                     |
| `TMDB_READ_ACCESS_TOKEN` | TMDB API Read Access Token sent only in the Authorization header; required for live resolution               |
| `metadata-policy.json`   | Reviewed provider permission basis and fixed metadata allowlists, per [providers.md](providers.md)           |

Missing provider configuration fails affected operations visibly while saved reads remain available.
Storage/migration failure prevents readiness and startup. Health reports storage and provider
configuration separately, without secret values. Database failure never returns success.

## Limits and pagination

Accept a JSON body up to 16 KiB with 1-20 inputs. A title must have 1-300 trimmed characters;
preserve the original submitted title. Optional `year` is an integer from 1800-2200. Optional
`workType` is `film` or `television_series`. Reject null optional values, unknown fields, and wrong
types with input-specific errors. Validate the whole request before writes/provider calls.

Resolve at most 20 candidates/input and search at most 20 results/distinct work. Allow at most 20
requests with pending/running operations; submissions, retries, and final selections that exceed
this limit fail before mutation with `429 local_capacity`.

Lists accept `limit` from 1-100, default 25, and an optional cursor. Return `items`, `nextCursor` or
null, and `snapshotAt`. Cursor scope includes endpoint/filter, maximum row sequence, and last
sequence. Reject malformed/mismatched cursors with 400. Pagination reads saved rows only. New
traversals include later inserts. Embedded input/work summaries are bounded by the submission limit;
attempts and observations always use pagination.

## Endpoints

| Method/path                                                      | Request                                                       | Success                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`                                                    | None                                                          | `200` storage readiness and provider configuration flags                    |
| `POST /v1/search-requests`                                       | `{"inputs":[{"title":"Heat","year":1995,"workType":"film"}]}` | `202` requestId, statusUrl, queued count                                    |
| `GET /v1/search-requests`                                        | Pagination                                                    | `200` saved summaries                                                       |
| `GET /v1/search-requests/:id`                                    | None                                                          | `200` ordered inputs, selected IDs, counts, per-work coverage, next actions |
| `GET /v1/search-requests/:id/inputs/:inputId/candidates`         | Pagination                                                    | `200` candidate metadata, eligibility, provenance, limits                   |
| `POST /v1/search-requests/:id/selections`                        | `{"selections":[{"inputId":"...","candidateId":"..."}]}`      | `200` summary; final selection also queues search                           |
| `GET /v1/search-requests/:id/works`                              | Pagination                                                    | `200` selected works, input mappings, selection snapshots                   |
| `GET /v1/search-requests/:id/sources`                            | Pagination, optional workId                                   | `200` one row/source with matching work IDs and observation links           |
| `GET /v1/search-requests/:id/operations`                         | Pagination                                                    | `200` operations, latest attempts, safe errors/counts/retry times           |
| `GET /v1/search-requests/:id/operations/:operationId/attempts`   | Pagination                                                    | `200` historical attempts and query provenance                              |
| `GET /v1/search-requests/:id/operations/:operationId/rejections` | Pagination                                                    | `200` rejected ordinals/reasons with attempt IDs                            |
| `POST /v1/search-requests/:id/retry`                             | operationIds array or `{}`                                    | `202` queued IDs, or `200` empty list if none qualify                       |
| `GET /v1/works/:id`                                              | None                                                          | `200` stable identity and first-selected metadata provenance                |
| `GET /v1/sources/:id`                                            | None                                                          | `200` identity/location, unknown content rights, observations URL           |
| `GET /v1/sources/:id/observations`                               | Pagination, optional requestId                                | `200` metadata with query/rank/time and request/work associations           |

Selection batches contain 1-20 unique input IDs; `candidateId: null` means decline. Validate all
ownership and eligibility before mutation. One invalid choice rejects the whole batch. The final
selection freezes memberships and queues search atomically. Frozen selections cannot change.

Retry arrays contain at most 20 unique operation IDs in this request. Explicit succeeded, active, or
not-yet-due operations produce `409 operation_not_retryable` without changes. `{}` selects only due
failed/interrupted operations. Unknown IDs return 404. Repeated retry requests never restart
completed work. Configuration must be corrected before an affected retry can succeed.

## Response meaning

Request status is `resolving`, `needs_input`, `blocked`, `searching`, `completed`, `partial`, or
`failed`, per the [model](../data-model.md). Summaries include limits, freeze time, input states,
distinct-work count, operation counts by state, per-work coverage, `coverageBounded: true`, limit
flags, and next actions with affected IDs.

Candidates include distinguishing details, TMDB media type/ID, provider identity URL, retrieval
time, and eligibility. Work references remain local UUIDs; no provider revision is invented.
Candidate search excludes adult results and exposes bounded coverage. Missing values are null.
Source output uses `kind: "source_candidate"`, `relevanceVerified: false`, stable IDs, nullable
metadata, and provenance links. Each observation exposes query, rank, provider, time, request ID,
and safe notices through its attempt. Source-content `processingPermission` and `displayPermission`
remain `unknown`. Suppressed metadata has a restriction indicator.

Completed searches can have `no_sources`; show rejection counts separately from provider-empty
results. Completion means the bounded search plan finished, not that every source is relevant or all
sources were found. Saved reads make no provider calls.

## Errors and atomicity

Errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`. Details contain
validated field paths or local IDs, never credentials, raw payloads, or provider exception text.

| Status  | Meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| 400     | Malformed JSON/cursor/query                                         |
| 403     | Host/origin rejection                                               |
| 404     | Unknown or out-of-scope record                                      |
| 409     | Frozen set, ineligible/stale choice, retry timing or state conflict |
| 413/415 | Oversized body/unsupported content type                             |
| 422     | Invalid submission/selection fields                                 |
| 429     | Local capacity reached                                              |
| 500/503 | Internal/storage failure with a safe code                           |

Provider failures after acceptance remain saved operation outcomes. Reading that failure returns 200
when the record is readable. Database errors roll back the current mutation and preserve prior
commits. Repeated submission POSTs create separate requests and can incur new provider calls; shared
work/source identities are reused. No submission deduplication token is introduced.
