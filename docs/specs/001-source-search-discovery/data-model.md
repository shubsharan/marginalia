# Discovery data model

Planned SQLite model for [the specification](spec.md). Local records have UUIDs and UTC timestamps.
Foreign keys are enabled. Provider observations and selection snapshots retain their original
values.

## Records and constraints

| Record                  | Fields and constraints                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovery_requests`    | ID, created time, nullable work-set freeze time, validated versioned limits snapshot.                                                                                                                                                                                              |
| `title_inputs`          | ID, request ID, position, original title, normalized search title, optional year/type, resolution state, nullable selected candidate ID and selection time. Unique request/position.                                                                                               |
| `resolution_candidates` | ID, input ID, attempt ID, ordinal, provider, provider media type, provider ID, title, original title, application type, release/first-air date, original language, available origin countries, retrieval time, eligibility/reason. Unique attempt/provider/media-type/provider-ID. |
| `works`                 | Local UUID, provider, provider media type, provider ID, first-selected title/type/details, identity URL, retrieval time, created time. Unique provider/media-type/provider-ID.                                                                                                     |
| `request_works`         | Request ID, work ID, representative selected candidate ID. Unique request/work. Each input also keeps its own selection snapshot.                                                                                                                                                  |
| `sources`               | ID, normalized URL, source host, created time. Unique normalized URL. Processing/display permission for source content stays `unknown`.                                                                                                                                            |
| `discovery_records`     | ID, request ID, work ID, source ID, first-found time. Unique request/work/source. Work must belong to this request.                                                                                                                                                                |
| `source_observations`   | ID, discovery record ID, attempt ID, provider result ID, ordinal, original permitted URL, nullable title/author/publisher/publication date, observed time, metadata policy revision. Unique attempt/result ordinal.                                                                |
| `operations`            | ID, request ID, resolution/discovery kind, affected input ID or work ID, state, current attempt ID. Exactly one target according to kind. Unique input for resolution; unique request/work for discovery.                                                                          |
| `operation_attempts`    | ID, operation ID, attempt number, state, start/deadline/finish times, provider, exact query/context and template version, provider request ID, safe error code, retry time, counts, limit flags, notice codes. Unique operation/attempt number.                                    |
| `rejected_results`      | ID, attempt ID, ordinal, safe reason code. No raw URL or provider payload.                                                                                                                                                                                                         |
| `schema_migrations`     | Applied version, checksum, applied time. Migration and version insertion commit together.                                                                                                                                                                                          |

Use bounded JSON for candidate metadata arrays and validated limits. Memberships, identity, state,
and associations remain relational. Unique constraints enforce deduplication. A source can have
multiple observations and work associations while retaining one identity.

## Identity and metadata

Use a local UUID for every work and `(tmdb, movie|tv, id)` for provider identity uniqueness. Never
merge a movie and TV series sharing a numeric ID, or merge works by title/year. Derive identity URLs
as `https://www.themoviedb.org/movie/{id}` or `https://www.themoviedb.org/tv/{id}`. Do not require a
Wikidata or IMDb mapping. Save first-selected metadata without overwriting earlier request snapshots
when later searches return changed labels or dates. Missing provider records do not invalidate saved
local references. Reconciliation of replacement IDs belongs to later maintenance; do not infer it
here. No provider revision field is fabricated.

Normalize source URLs with the standard URL parser. Accept HTTP/HTTPS with a public hostname. Reject
credentials, local hostnames, IP literals, control characters, unsupported schemes, and overlong
URLs. Remove fragments; normalize hostname casing and default ports through the parser. Preserve
path case and query parameters/order. Do not strip tracking parameters, merge HTTP with HTTPS, fetch
canonical tags, follow redirects, or merge matching titles. This feature never fetches source URLs.

Missing optional metadata is null. A hostname is not a publisher. Query and rank are attributed,
unverified relevance, never confidence. Request reads use that request's observations rather than
metadata from later requests. Source detail exposes identity and paginated observations with origin.
The current provider metadata allowlist applies to historical reads. Suppressed fields have an
explicit restriction indicator. Safe IDs, counts, and status stay inspectable without provider
calls.

## Resolution and selections

Resolution moves from `pending` to `running`, then `needs_selection`, `unresolved`, `failed`, or
`interrupted`. Publish candidates only after every required TMDB search succeeds. Failure of one
endpoint for an untyped input cannot become a successful singleton result from the other endpoint.

Eligible candidates require confirmation, including singletons. Selection sets `resolved`. Decline
sets `unresolved` with reason `declined`. No eligible candidate yields `no_match`,
`conflicting_details`, or `unsupported_type`. Successful unresolved searches are not technical
failures to retry. Clarifying an input requires a new request.

Before freeze, callers can select another saved eligible candidate or reverse a decline. Selections
validate candidate/input/request ownership. Once all inputs resolve, a single transaction freezes
memberships and queues one discovery operation per distinct work. Subsequent selection changes
return `409 work_set_frozen`. Preserve duplicate original inputs with one membership.

## Attempts, recovery, and retry

Operations use `pending`, `running`, `succeeded`, `failed`, and `interrupted`. Claiming pending work
atomically creates an attempt and installs its ID as current. External calls occur outside write
transactions. Each attempt expires after 60 seconds; each call times out after 15 seconds including
response consumption. Resolution makes at most two calls; discovery makes one.

Publishing results or failure checks current attempt ID, running state, and unexpired deadline in
the same transaction. Late responses cannot change results. A once-per-second sweep and startup
recovery mark expired attempts interrupted. Reads also interpret expired running attempts as
interrupted. Pending work resumes on startup; interrupted work needs explicit retry. Graceful
shutdown stops claims and cancels active work into interrupted state.

Retry queues only failed/interrupted operations after their retry time. Repeated retries cannot
queue duplicate pending/running work. Closed attempts remain historical. Completed results never
re-enter the queue. A crash after provider receipt but before local commit can incur another
provider call; transactional local publication does not provide exactly-once provider billing.

## Derived request progress

Apply these rules in order; always include all failures and required actions separately:

1. Pending/running resolution means `resolving`.
2. Before freeze, failed/interrupted resolution means `blocked`. Otherwise unselected inputs mean
   `needs_input`.
3. After freeze, pending/running discovery means `discovering`.
4. All discovery operations succeeded means `completed`, including successful empty searches.
5. Otherwise use `partial` if any discovery succeeded, or `failed` if none succeeded.

Per-work coverage distinguishes pending, running, sources_found, no_sources, failed, and
interrupted. Expose returned/retained/rejected counts, limit flags, and next actions. Twenty
returned Exa results sets `result_limit_reached`. Fewer results do not prove exhaustiveness. Empty
usable results with rejections remain distinguishable from a provider returning no entries.

## Persistence and pagination

Transactions cover submission, candidate publication, selections/freeze, claims, result publication,
recovery, and retry. Index input order, operation state/deadline, request memberships/associations,
and source observations. Use monotonic internal sequence IDs for keyset pagination alongside public
UUIDs. Capture the maximum sequence in the first-page cursor so later inserts do not shift
traversal. A fresh traversal includes newly committed rows. Pagination is bounded but can reach
every saved row.

Apply migrations before readiness. Roll back a failed migration without changing existing data or
the schema version. Reject changed applied checksums and unknown newer schemas. Keep
database/WAL/SHM files together on local disk. Run explicit migrations with the server stopped.
