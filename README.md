# Marginalia

Search for research-source candidates about a collection of films and television series. The local
JSON API resolves titles through TMDB, waits for your explicit selections, queries Exa Search, and
saves source metadata and provenance in SQLite. It never retrieves source pages or generates claims.

Phase 5 implements submission, confirmation, search, saved reads, selective retry, and crash
recovery. Remaining metadata checks and full live acceptance stay planned. See the
[acceptance guide](docs/specs/001-search/quickstart.md) for recorded evidence and the
[API contract](docs/specs/001-search/contracts/search-api.md) for limits and response meanings.

## Set up local search

Use Bun 1.4.2, `curl`, and `jq`. Live execution needs a TMDB API Read Access Token, an Exa API key
with search credits, and reviewed metadata permissions for both providers.

From the repository root:

```sh
bun install --frozen-lockfile
cp apps/search/.env.example apps/search/.env.local
```

Set `TMDB_READ_ACCESS_TOKEN` and `EXA_API_KEY` in the ignored `apps/search/.env.local`. The optional
`MARGINALIA_DB_PATH` defaults to `apps/search/data/search.sqlite`; relative paths resolve from
`apps/search`, regardless of the launch directory. Keep credentials out of URLs and policy files.

Review retention and display of the complete fixed field set in the
[provider contract](docs/specs/001-search/contracts/providers.md). In
`apps/search/metadata-policy.json`, record a new `revision` and each provider's `reviewedAt` date
and `permissionBasis` reference. The committed template is unreviewed and blocks calls and metadata
reads. Do not approve it using test-fixture permissions. Legacy `retainedFields` and
`displayedFields` arrays are rejected. Restart after changing policy. Follow the
[TMDB FAQ](https://developer.themoviedb.org/docs/faq) for the applicable attribution, logo, and
licensing requirements. Metadata approval does not grant rights to source-page content.

With the server stopped, initialize or migrate the database, then start:

```sh
bun run --cwd apps/search db:migrate
bun run --cwd apps/search start
```

Startup requires the current schema and checks migration checksums and SQLite integrity. An error
preserves existing storage. Earlier experimental schemas have no compatibility migration; use a
fresh database path without deleting saved data. Keep SQLite, WAL, and SHM files together.

In another terminal:

```sh
curl --fail-with-body -sS http://127.0.0.1:4310/health | jq
```

Expect `storage.ready: true` and separate provider configuration flags. Those flags do not verify
account access or permissions. The API binds to `127.0.0.1:4310`, rejects browser origins, and
requires `application/json` mutations. Use the loopback address in the examples.

## Confirm works and search

```sh
search_request_id=$(curl --fail-with-body -sS \
  http://127.0.0.1:4310/v1/search-requests \
  -H 'Content-Type: application/json' \
  -d '{"inputs":[{"title":"Heat","year":1995,"workType":"film"},{"title":"Arrival","year":2016,"workType":"film"},{"title":"Breaking Bad","year":2008,"workType":"television_series"}]}' \
  | jq -r '.requestId')
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id" | jq
```

Poll until resolution finishes. For each input ID from the summary, inspect candidates:

```sh
search_input_id='replace-with-an-input-id-from-the-summary'
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/inputs/$search_input_id/candidates" | jq
```

Choose by identity, type, and date, including for a singleton. Send the confirmed candidate ID:

```sh
search_candidate_id='replace-with-the-confirmed-candidate-id'
jq -n --arg inputId "$search_input_id" --arg candidateId "$search_candidate_id" \
  '{selections:[{inputId:$inputId,candidateId:$candidateId}]}' \
  | curl --fail-with-body -sS \
      "http://127.0.0.1:4310/v1/search-requests/$search_request_id/selections" \
      -H 'Content-Type: application/json' --data-binary @- | jq
```

Repeat for every input. Search starts only after all inputs resolve. The frozen work set receives
one Exa query per distinct work; duplicate inputs keep their mappings. A declined or unmatched input
remains unresolved. Submit a new request to clarify inputs or change a frozen collection.

## Read saved results

Poll the summary for completion and inspect saved works and sources:

```sh
curl --fail-with-body -sS http://127.0.0.1:4310/v1/search-requests | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/works" | jq
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/sources?limit=2" | jq
```

Growing lists return `items`, `snapshotAt`, and `nextCursor`. Follow a non-null cursor with the same
endpoint and filters. Use `--get --data-urlencode "cursor=$search_cursor"` with curl when following
it. Limits are 1-100 rows per page. Candidate lists take no query parameters and return at most 20
current candidates.

Follow source `observationsUrl` links for title, author, publication date, exact query, rank, time,
and request/work associations. Stable references are available at `/v1/works/:id` and
`/v1/sources/:id`. Source lists accept `workId`; source observations accept `requestId`. Different
URLs remain distinct even when titles match. Repeated normalized URLs share one source identity.

Stop with Ctrl-C and restart using the same database to read the same saved IDs and observations.
Remove credentials from `.env.local` to verify saved reads without provider calls; keep reviewed
metadata approval. Missing approval returns `503 metadata_policy_missing` for that provider's
metadata, while local inputs, selections, counts, and status remain readable.

Requests accept 1-20 inputs and a 16 KiB JSON body. Searches retain at most 20 results per work.
Coverage is bounded, result relevance is unverified, and source processing/display permissions stay
`unknown`. Summaries distinguish empty success, rejected URLs, and failures. Graceful shutdown
interrupts active work. Startup and one-second sweeps mark expired attempts interrupted; pending
work resumes, while failed or interrupted work requires explicit retry after its saved retry time.

```sh
curl --fail-with-body -sS \
  "http://127.0.0.1:4310/v1/search-requests/$search_request_id/retry" \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Use `{}` to retry all due failures or `{"operationIds":["operation-id-from-nextActions"]}` to choose
operations. Completed work never repeats. A crash after a provider receives a request but before
local commit can still cause a repeated provider charge on retry.

## Check the implementation

```sh
bun run --cwd apps/search test
bun run --cwd apps/search check-types
bun run lint
bun run format
```

Ordinary tests use fixtures, temporary databases, and loopback servers. They make no live provider
calls. Recovery tests kill a child worker and separately release stale responses from surviving
workers. Live quality, permissions, and setup timing remain unverified. The opt-in live suite is
planned for Phase 7.
