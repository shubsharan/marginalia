# Validate search

This is the implementation acceptance guide. Phase 5 adds selective retry and crash recovery to the
implemented TMDB resolution, explicit selection, Exa Search, and saved reads. Remaining metadata
checks and full acceptance stay planned. No live provider or permission claim follows from the
fixture results.

## Historical Phase 3 verification

On 2026-10-23, Bun 1.4.2 passed 82 tests with 408 assertions across `body.test.ts`,
`providers.test.ts`, and `search.test.ts`. Tests use sanitized fixtures, temporary SQLite databases,
and loopback servers. The initial US2 tests failed because the TMDB and worker modules did not
exist. Frozen dependency installation, app type-check, repository lint, formatting, and
`git diff --check` passed after the owner-requested simplification.

Implementation revision: uncommitted Phase 3 changes based on
`23227decfde1cc357f1288492fe7dbe647d4b2f6`. The implementation snapshot SHA-256 is
`8e8c8834742839735e5253b235683568abcef3a27d82156ca3244c32f04a77db`. The digest covers `.gitignore`,
`bun.lock`, `apps/search/package.json`, `apps/search/src/**/*.ts`, `apps/search/tests/**/*.ts`, and
`apps/search/tests/fixtures/**/*.json`, fifteen files total. Sort the paths and hash each UTF-8
path, a NUL byte, its file bytes, and another NUL byte in sequence.

Hono 4.13.13 handles the existing routes and shared access checks. Zod 4.6.7 validates boundary data
and supplies inferred input types. Neverthrow 8.2.0 represents expected provider failures. The
shared JSON reader replaces duplicate byte-reading loops and manual chunk concatenation. Request
errors use one class; status rules use guard clauses; summaries join selected work IDs; candidate
parsing is separate from provider dispatch. New checks cover split UTF-8, oversized-stream
cancellation, raw-error redaction, synchronous fetch failures, and selection rollback after writes
begin. Database callbacks still throw to trigger rollback. No Phase 4 routes or search execution
were added.

Verified checks include remakes, alternative-title matches, movie/TV numeric-ID collisions, local
year eligibility, unknown dates, deterministic capped interleaving, endpoint coverage, exact Bearer
requests, and redirects that receive no credentials at their destination. Failed required searches
and failed database publication leave no candidates. Every singleton still needs confirmation.
Invalid batches, ineligible choices, capacity overflow, and repeated final selections preserve prior
state. Duplicate inputs retain their mappings and queue one search operation per distinct work.
Selections and summaries survive database reopen with no provider configuration. Calls run outside
transactions; cancellation and expired or superseded attempt publication checks pass.

Live TMDB compatibility, identity quality, and metadata permissions remain unverified. The committed
metadata policy still blocks live work until reviewed. Exa execution, crash recovery, and selective
retry were not run. SC-001, SC-002, SC-003, SC-004, SC-005, and SC-006 are each **NOT RUN** as full
acceptance criteria. The fixture checks prove only the Phase 3 behaviors listed here.

## Simplification verification

The simplification is an uncommitted change based on `66df58a`, the Phase 3 commit. The preceding
snapshot and 82-test report describe the historical implementation, not this revision.

Current app checks pass 80 tests with 407 assertions across the same three suites, plus the app
type-check. They cover current-attempt ordering and bounds, history exclusion, rejected candidate
queries, provider approval without credentials, blocked saved metadata with readable status, legacy
policy rejection, fresh database initialization, migration rollback, and foreign-key integrity. The
obsolete version-1 compatibility fixture and schema-inventory cases are removed. Existing selection,
transaction, redaction, timeout, and attempt-ownership checks remain.

Repository `bun run lint`, `bun run format`, and `git diff --check` pass. The current schema uses
one initial migration. No live requests or permission review were performed. Exa execution, source
reads, retry/recovery, and SC-001 through SC-006 full acceptance remain NOT RUN. Request summaries
omit the runtime limits snapshot; byte and timeout thresholds remain implementation defaults in
`src/config.ts`.

## Phase 4 verification

On 2026-10-23, Bun 1.4.2 passed 128 tests and 732 assertions across `body.test.ts`,
`providers.test.ts`, and `search.test.ts`. Tests use injected provider fixtures, temporary SQLite
databases, and loopback HTTP servers. The new US1 integration checks initially failed because the
worker did not execute queued searches; the Exa provider checks initially failed because its module
did not exist. The source-association snapshot regression also failed before its fix.

Implementation revision: uncommitted Phase 4 changes based on
`55199fe375f60baa47b48403475f09edf1b858e2`. The implementation snapshot SHA-256 is
`2773aff3ae90776256db28a3aa7a7007e5847e1eb7f3bd55dbc37490fc6375f1`. The digest covers `.gitignore`,
`bun.lock`, `apps/search/package.json`, `apps/search/src/**/*.ts`, `apps/search/tests/**/*.ts`, and
`apps/search/tests/fixtures/**/*.json`, seventeen files total. Sort the paths and hash each UTF-8
path, a NUL byte, its file bytes, and another NUL byte in sequence. No dependencies or schema
changes were required.

`bun install --frozen-lockfile`, `bun run --cwd apps/search test`,
`bun run --cwd apps/search check-types`, `bun run lint`, `bun run format`, and `git diff --check`
pass. README and quickstart shell examples pass `sh -n`; database, WAL, local env, and log ignore
probes pass. The checklist remained read-only with all 16 criteria checked. Both implementation
extension hooks are disabled, so no hook or automatic commit ran.

Verified behavior includes one Exa query per distinct frozen work, no search before all inputs are
confirmed, exact metadata-only request keys, safe redirects, URL normalization, shared source
identities, distinct same-title URLs, rejected-result counts, immutable query/rank/time
observations, successful empty results, and transaction rollback after an observation insert fails.
Six works at the full provider cap publish 120 observations and sources; 100-row source pages and
one-row work pages traverse all saved rows.

Saved reads preserve IDs and metadata after database reopen without credentials or provider calls,
while current approval still gates metadata. Fresh traversals get a new `snapshotAt`; saved data is
unchanged. Scoped cursors reject malformed or mismatched input. A source cursor captures the maximum
association sequence and applies it to both source membership and returned work IDs, preserving
preexisting associations and excluding later inserts. Pending searches resume after reopen;
completed searches do not repeat. Active shutdown becomes interrupted, and expired or superseded
search attempts cannot publish late sources. This does not prove the Phase 5 process-crash,
recovery-sweep, or selective-retry workflow.

The existing worker is now `createWorker` because it dispatches resolution and search serially.
Basic source observations are included so Phase 4 source links expose usable provenance; Phase 6
edge-case acceptance remains pending. The root README now contains the actual setup, policy,
migration, confirmation, and saved-read workflow. Live TMDB/Exa compatibility, metadata permission
review, relevance, and setup timing remain NOT RUN. SC-001 through SC-006 are each NOT RUN as full
feature acceptance.

## Phase 5 verification

On 2026-10-23, Bun 1.4.2 passed 144 tests and 874 assertions across `body.test.ts`,
`providers.test.ts`, `search.test.ts`, and `recovery.test.ts`. All providers use injected fixtures
or loopback HTTP servers with fake credentials and temporary SQLite databases. Before
implementation, retry checks failed with 404 and recovery checks timed out because expired attempts
stayed running.

Implementation revision: uncommitted Phase 5 changes based on
`8a60851eaef42cf83ac45b1552c9fbfc63ccb330`. The implementation snapshot SHA-256 is
`a4b78d70392442406ed6bf77e22532e7676751dd8f5089b4dda6730f406e1b4e`. It covers `.gitignore`,
`bun.lock`, `apps/search/package.json`, `apps/search/src/**/*.ts`, `apps/search/tests/**/*.ts`, and
`apps/search/tests/fixtures/**/*.json`, eighteen files total. Sort the paths and hash each UTF-8
path, a NUL byte, its file bytes, and another NUL byte in sequence. No dependencies or schema
changes were needed.

The child-process check kills a worker with SIGKILL during a held HTTP call, reopens its persistent
database, and verifies that committed observation IDs and values survive. Restart respects the
original unexpired 60-second deadline and does not reissue that call. The test then advances the
saved deadline to the past to exercise the one-second sweep without a minute-long wait. It does not
measure 60 seconds of elapsed recovery time. Explicit retry completes the interrupted work; pending
resolution resumes, and completed searches do not repeat.

Separate surviving-worker checks release delayed success and failure responses for both resolution
and search after a newer attempt completes. Database snapshots remain unchanged. Startup sweeps,
read-time interruption, retry before the next sweep, and graceful cancellation before and after
expiry also pass. Failed or interrupted attempts remain saved when retry queues another attempt.

API checks cover partial success, provider-empty versus all-rejected success, resolution failures,
rate limits and fallback delay, request ownership, completed or active operation rejection, early
and concurrent retries, capacity, and atomic rollback on storage failure. All required actions
remain visible even when summary precedence reports resolving. Completed observations retain their
original IDs and values after selective retry. Provider date and fallback-header checks remain
covered by the provider suite.

`bun run --cwd apps/search test`, `bun run --cwd apps/search check-types`, `bun run lint`,
`bun run format`, and `git diff --check` pass. README and quickstart shell examples pass `sh -n`.
Ignore rules already cover dependencies, build output, logs, local environment files, and search
database files. All sixteen checklist criteria remain checked and unmodified. Both implementation
extension hooks are disabled, so no hook or automatic commit ran.

A crash after provider receipt but before local commit can incur a repeated call and charge after
retry. These checks establish local publication and recovery behavior, not exactly-once provider
execution. Phase 6 metadata edge cases and Phase 7 acceptance remain pending. Live provider
compatibility, retention/display permission review, relevance, and setup timing remain NOT RUN.
SC-001 through SC-006 remain NOT RUN as full-feature acceptance criteria.

## Prerequisites

Use Bun 1.4.2, network access to TMDB and Exa, `curl`, and `jq`. Configure an Exa account with
available search credits. Before live retention, review provider metadata permissions and record
their basis, review date, and revision in `apps/search/metadata-policy.json`. Approval covers the
complete fixed stored/displayed field set in the provider contract. Legacy field-list policies are
rejected; review the full fixed set before removing their arrays and recording renewed approval. The
committed template remains unreviewed. Restart the app after policy changes. TMDB usage requires an
API Read Access Token and applicable retention/display permission and attribution; commercial use
requires the relevant license. Include the approved TMDB logo and required attribution notice in the
operator credits according to the [TMDB FAQ](https://developer.themoviedb.org/docs/faq). Metadata
permissions do not cover linked source pages. See [provider contracts](contracts/providers.md).

The app commands below also appear in the root README. Store secrets only in the ignored
`apps/search/.env.local`, copied from the committed `.env.example`. Set `EXA_API_KEY` and
`TMDB_READ_ACCESS_TOKEN`; optionally set `MARGINALIA_DB_PATH`. No key belongs in a URL, fixture,
policy file, saved result, or acceptance log.

## Initialize and start

From the repository root, run:

```sh
bun install --frozen-lockfile
cp apps/search/.env.example apps/search/.env.local
# Fill in the local configuration before continuing.
bun run --cwd apps/search db:migrate
bun run --cwd apps/search start
```

The scripts load the app's `.env.local` explicitly and use the same database path. Migrations run
transactionally and startup checks schema compatibility and SQLite integrity before readiness. Keep
the runtime running. In a second terminal, check readiness:

```sh
curl --fail-with-body http://127.0.0.1:4310/health | jq
```

Expect storage ready and provider configuration status. A missing provider key or policy must be
named without printing its value. A migration/storage failure must prevent readiness and preserve
existing data. The single initial migration defines the current greenfield schema without request
limits snapshots. Use a fresh `MARGINALIA_DB_PATH` if an earlier experimental database exists; there
is no compatibility migration, and existing files are not deleted automatically. Stop the server
before running migrations against existing storage. Startup no longer inventories individual columns
or triggers; it still rejects pending migrations, changed checksums, newer schemas, and integrity
errors.

## Submit, select, and inspect

```sh
search_request_id=$(curl --fail-with-body -sS \
  http://127.0.0.1:4310/v1/search-requests \
  -H 'Content-Type: application/json' \
  -d '{"inputs":[{"title":"Heat","year":1995,"workType":"film"},{"title":"Arrival","year":2016,"workType":"film"},{"title":"Breaking Bad","year":2008,"workType":"television_series"}]}' \
  | jq -r '.requestId')
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id" | jq
```

Poll the saved summary until resolution finishes. For each input ID, inspect its saved candidates:

```sh
search_input_id='replace-with-an-input-id-from-the-summary'
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/inputs/$search_input_id/candidates" | jq
```

Candidate reads accept no query parameters. They return only the current attempt's candidates in
ordinal order, at most 20, with query context, counts, and coverage flags. An attempt without
published candidates returns an empty list. Responses omit cursor and snapshot fields; internal
history remains stored. Missing approval returns `503 metadata_policy_missing`, while local summary
and selection references stay readable. Credentials are not needed for saved reads.

Confirm the intended candidate using its title, type, year, and identity provenance. Do not choose
the first result solely because it ranks first. Send one selection per input, or a batch:

```sh
search_candidate_id='replace-with-the-confirmed-candidate-id'
jq -n --arg inputId "$search_input_id" --arg candidateId "$search_candidate_id" \
  '{selections:[{inputId:$inputId,candidateId:$candidateId}]}' \
  | curl --fail-with-body -sS \
      "http://127.0.0.1:4310/v1/search-requests/$search_request_id/selections" \
      -H 'Content-Type: application/json' --data-binary @- | jq
```

Repeat for remaining inputs. Expect no Exa calls until every input resolves. Final selection freezes
the set and queues exactly three work searches. The serial worker executes them through Exa. Poll
the summary, then inspect saved works and sources:

```sh
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/works" | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/sources?limit=2" | jq
```

Use each `nextCursor` with the same filters until it is null. Expect every saved source once in that
traversal. Follow source-observation links to see exact queries, search times, rank, notices, and
work associations. Results must identify candidates, show missing metadata, and keep content rights
unknown. No response may contain source text, extracted claims, or generated relevance explanations.

Record elapsed setup time for SC-001. Stop and restart with the same database. Repeat saved reads
without provider credentials/network access, retaining reviewed metadata approval. IDs and results
must remain unchanged and no search runs.

## Retry a failure

Phase 5 implements this workflow. Inspect affected operation IDs, errors, counts, retry times, and
next actions in the summary, then retry after the saved retry time. Dedicated operation-list,
attempt-history, and rejection-history endpoints are deferred.

```sh
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id" | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/retry" \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Expect only failed/interrupted operations to run. Successful work retains its IDs and observations.
Unmatched or declined inputs require a clarified new request, not a technical retry.

To select failures explicitly, send `{"operationIds":["operation-id-from-nextActions"]}`. Responses
contain `queuedOperationIds`, with 202 when work is queued or 200 for an empty list. Explicit
completed, active, or early operations return 409 without changes. Unknown or wrong-request IDs
return 404. Invalid batches and capacity failures leave the entire request unchanged.

At startup and every second, the worker closes expired attempts as interrupted. Reads also show
expired work as interrupted before the sweep. Pending work resumes automatically; interrupted work
requires explicit retry. Graceful shutdown interrupts active work. A crash after provider receipt
but before local commit can cause another provider call and charge on retry. Local transactional
publication does not guarantee exactly-once provider execution.

## Run deterministic checks

Run these commands without live providers or real credentials:

```sh
bun run --cwd apps/search test
bun run --cwd apps/search check-types
bun run lint
bun run format
```

The `test` script excludes the opt-in live suite. The complete feature requires these acceptance
cases; later-phase rows remain planned:

| Case                 | Expected proof                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input validation     | Empty/blank/over-limit/malformed inputs make zero provider calls; errors identify inputs. Twenty inputs are accepted.                                                                                                                                 |
| Resolution           | Remakes, film/series collisions, unknown metadata, conflicting details, movie/TV numeric-ID collisions, missing dates, aliases, failure of one required search, and capped/interleaved candidates remain explicit. No unconfirmed work starts search. |
| Selection            | Wrong-input candidates, ineligible choices, partial invalid batches, and post-freeze edits preserve prior state. Concurrent final selections queue one operation/work.                                                                                |
| Provider boundary    | Exact Exa request keys omit content and synthesis. Injected text/highlights/summary/raw errors never reach storage, logs, or reads. TMDB error envelopes fail visibly; Bearer tokens never appear in URLs or output.                                  |
| Source identity      | Duplicate locations across selected works and requests reuse IDs; different locations with the same title stay separate. Unsafe URLs are counted as rejected results.                                                                                 |
| Metadata             | Null fields stay null; rank/query remain unverified; missing provider approval blocks historical metadata reads; source-content permissions stay unknown.                                                                                             |
| Coverage             | Empty success differs from timeout/access/rate failures, all-invalid results, partial progress, and limit reached. Current candidates fit one response; growing saved result lists remain fully traversable.                                          |
| Retry                | Only failed/interrupted work repeats, early retries fail, duplicate retries cannot create concurrent attempts, and completed associations never duplicate.                                                                                            |
| Provider redirects   | Both provider adapters use `redirect: "error"`. Local redirect endpoints and fake credentials prove that redirects fail the operation and the destination receives no request.                                                                        |
| Crash recovery       | Kill the child runtime during a held provider call, restart, verify the unexpired 60-second deadline, then advance its saved timestamp to test interruption. Pending work resumes; explicit retry preserves committed results.                        |
| Stale responses      | In a separate test, keep the original worker alive with a delayed response, expire its attempt, and complete a newer attempt after retry. Release the old response and assert that it cannot change the newer attempt's status or saved results.      |
| Storage              | Migration failure rolls back; changed checksum/newer schema fail startup; previously committed IDs/results survive. Storage write failures never return success.                                                                                      |
| Local access/secrets | Remote bind is absent; invalid Host/Origin/content type is rejected; fake secrets injected into errors are absent from DB/log/output.                                                                                                                 |

Use fetch injection and temporary databases in tests, not production endpoints that simulate
failure. The recovery test launches a child process and controls provider responses; checking only
in-memory state is insufficient. Database assertions check uniqueness and original observation
retention.

## Measure live quality separately

Before the first live run, commit a ten-work corpus with known TMDB media-type/ID identities,
title/year/type, and a review rubric. Include film and television, remakes, and aliases. Do not
change the corpus after seeing results. A relevant source must address the intended work and offer
substantive criticism, analysis, an interview, or production context; a title match alone is
insufficient.

```sh
bun run --cwd apps/search test:live
```

This opt-in command uses real services and may incur Exa charges. Record revision, corpus version,
date, selected identities, queries, notices, failures, time, and permitted source references. A
human may review linked sources outside the application to score relevance; this is not an ingestion
step. Pass SC-002 only if all ten identities are correct and at least nine works have a relevant
source. Provider-free checks cannot substitute for this result.

Report SC-001 through SC-006 individually as PASS, FAIL, or NOT RUN with evidence. Full-feature
acceptance remains NOT RUN after Phase 5.
