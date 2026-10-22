# Validate source search and discovery

This is the implementation acceptance guide. The application, scripts, fixtures, and routes below
are planned and do not exist yet. Do not report these checks as passed during planning.

## Prerequisites

Use Bun 1.4.2, network access to TMDB and Exa, `curl`, and `jq`. Configure an Exa account with
available search credits. Before live retention, review provider metadata permissions and record
their basis and field allowlists in the planned `apps/discovery/metadata-policy.json`. TMDB usage
requires an API Read Access Token and applicable retention/display permission and attribution;
commercial use requires the relevant license. Include the approved TMDB logo and required
attribution notice in the operator credits according to the
[TMDB FAQ](https://developer.themoviedb.org/docs/faq). Metadata permissions do not cover linked
source pages. See [provider contracts](contracts/providers.md).

The implementation must add the commands below and document them in the root README. Store secrets
only in the ignored `apps/discovery/.env.local`, copied from the committed `.env.example`. Set
`EXA_API_KEY` and `TMDB_READ_ACCESS_TOKEN`; optionally set `MARGINALIA_DB_PATH`. No key belongs in a
URL, fixture, policy file, saved result, or acceptance log.

## Initialize and start

From the repository root, run these planned commands:

```sh
bun install --frozen-lockfile
cp apps/discovery/.env.example apps/discovery/.env.local
# Fill in the local configuration before continuing.
bun run --cwd apps/discovery db:migrate
bun run --cwd apps/discovery start
```

The scripts load the app's `.env.local` explicitly and use the same database path. Migrations run
transactionally and startup verifies the schema before readiness. Keep the runtime running. In a
second terminal, check readiness:

```sh
curl --fail-with-body http://127.0.0.1:4310/health | jq
```

Expect storage ready and provider configuration status. A missing provider key or policy must be
named without printing its value. A migration/storage failure must prevent readiness and preserve
existing data. Stop the server before running migrations against existing storage.

## Submit, select, and inspect

```sh
discovery_request_id=$(curl --fail-with-body -sS \
  http://127.0.0.1:4310/v1/discovery-requests \
  -H 'Content-Type: application/json' \
  -d '{"inputs":[{"title":"Heat","year":1995,"workType":"film"},{"title":"Arrival","year":2016,"workType":"film"},{"title":"Breaking Bad","year":2008,"workType":"television_series"}]}' \
  | jq -r '.requestId')
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id" | jq
```

Poll the saved summary until resolution finishes. For each input ID, inspect its saved candidates:

```sh
discovery_input_id='replace-with-an-input-id-from-the-summary'
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/inputs/$discovery_input_id/candidates" | jq
```

Confirm the intended candidate using its title, type, year, and identity provenance. Do not choose
the first result solely because it ranks first. Send one selection per input, or a batch:

```sh
discovery_candidate_id='replace-with-the-confirmed-candidate-id'
jq -n --arg inputId "$discovery_input_id" --arg candidateId "$discovery_candidate_id" \
  '{selections:[{inputId:$inputId,candidateId:$candidateId}]}' \
  | curl --fail-with-body -sS \
      "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/selections" \
      -H 'Content-Type: application/json' --data-binary @- | jq
```

Repeat for remaining inputs. Expect no Exa calls until every input resolves. Final selection freezes
the set and queues exactly three work searches. Poll the summary, then inspect saved works and
sources:

```sh
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/works" | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/sources?limit=2" | jq
```

Use each `nextCursor` with the same filters until it is null. Expect every saved source once in that
traversal. Follow observation/attempt links to see exact queries, discovery times, rank, notices,
and work associations. Results must identify candidates, show missing metadata, and keep content
rights unknown. No response may contain source text, extracted claims, or generated relevance
explanations.

Record elapsed setup time for SC-001. Stop and restart with the same database. Repeat saved reads
without provider credentials/network access. IDs and results must remain unchanged and no search
runs.

## Retry a failure

The deterministic integration suite supplies one successful work search and one timeout. Inspect the
summary and operations, then retry after the saved retry time:

```sh
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/operations" | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/discovery-requests/$discovery_request_id/retry" \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Expect only failed/interrupted operations to run. Successful work retains its IDs and observations.
Unmatched or declined inputs require a clarified new request, not a technical retry.

## Run deterministic checks

These planned commands must run without live providers or real credentials:

```sh
bun run --cwd apps/discovery test
bun run --cwd apps/discovery check-types
bun run lint
bun run format
```

The `test` script excludes the opt-in live suite. Require these acceptance cases:

| Case                 | Expected proof                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input validation     | Empty/blank/over-limit/malformed inputs make zero provider calls; errors identify inputs. Twenty inputs are accepted.                                                                                                                                    |
| Resolution           | Remakes, film/series collisions, unknown metadata, conflicting details, movie/TV numeric-ID collisions, missing dates, aliases, failure of one required search, and capped/interleaved candidates remain explicit. No unconfirmed work starts discovery. |
| Selection            | Wrong-input candidates, ineligible choices, partial invalid batches, and post-freeze edits preserve prior state. Concurrent final selections queue one operation/work.                                                                                   |
| Provider boundary    | Exact Exa request keys omit content and synthesis. Injected text/highlights/summary/raw errors never reach storage, logs, or reads. TMDB error envelopes fail visibly; Bearer tokens never appear in URLs or output.                                     |
| Source identity      | Duplicate locations across selected works and requests reuse IDs; different locations with the same title stay separate. Unsafe URLs are counted as rejected results.                                                                                    |
| Metadata             | Null fields stay null; rank/query remain unverified; policy restrictions suppress historical metadata; source-content permissions stay unknown.                                                                                                          |
| Coverage             | Empty success differs from timeout/access/rate failures, all-invalid results, partial progress, and limit reached. Every saved row is reachable through pagination.                                                                                      |
| Retry                | Only failed/interrupted work repeats, early retries fail, duplicate retries cannot create concurrent attempts, and completed associations never duplicate.                                                                                               |
| Crash recovery       | Kill the child runtime during a held provider call, restart, wait for the 60-second deadline, and see interrupted status. Retry then release the old response; it cannot publish. Pending work resumes.                                                  |
| Storage              | Migration failure rolls back; changed checksum/newer schema fail startup; previously committed IDs/results survive. Storage write failures never return success.                                                                                         |
| Local access/secrets | Remote bind is absent; invalid Host/Origin/content type is rejected; fake secrets injected into errors are absent from DB/log/output.                                                                                                                    |

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
bun run --cwd apps/discovery test:live
```

This opt-in command uses real services and may incur Exa charges. Record revision, corpus version,
date, selected identities, queries, notices, failures, time, and permitted source references. A
human may review linked sources outside the application to score relevance; this is not an ingestion
step. Pass SC-002 only if all ten identities are correct and at least nine works have a relevant
source. Provider-free checks cannot substitute for this result.

Report SC-001 through SC-006 individually as PASS, FAIL, or NOT RUN with evidence. During this
planning workflow all runtime acceptance remains NOT RUN.
