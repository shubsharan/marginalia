# Tasks: Search

**Input**: Design documents in `docs/specs/001-search/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [API contract](contracts/search-api.md),
[provider contract](contracts/providers.md), and [quickstart.md](quickstart.md). Follow
`.specify/memory/constitution.md` version 3.0.0.

**Status**: Search is partially implemented through Phase 4. Simplification tasks T037-T040 and
Phase 4 tasks T015-T021 are complete; Phases 5-7 remain planned. Current verification is recorded
separately in [quickstart.md](quickstart.md).

**Historical Phase 3 evidence**: On 2026-10-23, Bun 1.4.2 passed 82 tests and 408 assertions against
sanitized fixtures, temporary databases, and loopback HTTP servers. US2 checks cover bounded TMDB
resolution, explicit selection, atomic publication and freeze, identity reuse, candidate pagination,
capacity limits, cancellation, attempt ownership, and saved selections after reopen. All 43
foundational tests still pass. The owner-requested Hono, Zod, and neverthrow refactor also checks
shared stream cancellation and UTF-8, safe schema errors, routing access controls, and selection
rollback after a storage failure. Frozen dependency installation, app type-check, repository lint,
formatting, and diff checks passed. Evidence applies to the uncommitted Phase 3 changes based on
`23227de`; [quickstart.md](quickstart.md) records the implementation snapshot. Live provider
compatibility and identity quality, Exa execution, crash recovery, and SC-001 through SC-006
acceptance remain NOT RUN.

**Tests**: Tasks implement the specification's independent tests, acceptance scenarios, and SC-001
through SC-006 using the suites selected in the plan. Write each story's checks before its
implementation and confirm they fail for the intended missing behavior. Use injected fetch and
temporary databases; ordinary tests must never call live providers. Live acceptance is separate.

**Organization**: Each story has one phase. US2 precedes US1 because caller-confirmed identities are
required before search; both have priority P1. The minimum usable search increment is US2 plus US1,
not an automatic-selection shortcut.

## Format and path conventions

- Each task has an unchecked box, sequential ID, optional `[P]`, and a story label in story phases.
- `[P]` identifies tasks that can run together within the dependency group stated below. It does not
  waive earlier phase prerequisites or permit concurrent edits to the same file.
- Paths are relative to the repository root. Runtime code belongs in `apps/search/`.
- Reuse Bun, SQLite, native fetch, existing workspace globs, and shared TypeScript configuration.
  Use the owner-approved Hono, Zod, and neverthrow packages for routing, validation, and expected
  provider failures. Do not add an ORM, queue service, or general provider layer.
- Keep provider request/response types in their provider modules and database operations in the
  planned modules. Do not create placeholder layers to make tasks appear independent.

## Phase 1: Setup

**Purpose**: Add the backend workspace and its local configuration without changing unrelated work.

- [x] T001 Create `apps/search/package.json` and `apps/search/tsconfig.json`, reuse
      `@repo/typescript-config`, add the required Bun development types, and update `bun.lock` using
      the pinned Bun version. Define `dev`, `start`, `db:migrate`, `test`, `test:live`, and
      `check-types` scripts targeting the planned modules; exclude `tests/live-acceptance.test.ts`
      from ordinary tests and load the app's `.env.local` explicitly for runtime/migrations. Reuse
      root `package.json` workspace settings without changing Turborepo configuration.
- [x] T002 [P] Add secret-free examples for `EXA_API_KEY`, `TMDB_READ_ACCESS_TOKEN`, and
      `MARGINALIA_DB_PATH` in `apps/search/.env.example`; update `.gitignore` for search database,
      WAL, and SHM files while preserving existing local-env exclusions.

**Checkpoint**: Dependencies install, configuration examples contain no credentials, and the app
extends the existing workspace. Scripts become runnable as their modules are implemented.

## Phase 2: Foundational prerequisites

**Purpose**: Establish storage, configuration, and local access controls shared by all stories.

- [x] T003 [P] Implement configuration and metadata-policy validation in `apps/search/src/config.ts`
      and add a fail-closed `apps/search/metadata-policy.json` template. Resolve the database path
      from the app directory regardless of working directory; expose provider readiness without
      secrets, require a reviewed permission basis and fixed retained/displayed field allowlists for
      live provider work, and keep saved reads available when credentials are missing. Apply the
      limits from `contracts/search-api.md` and `contracts/providers.md`. Field-level policy is
      superseded by the provider gate in T038.
- [x] T004 [P] Define `apps/search/migrations/001_search.sql` from `data-model.md`: requests,
      ordered inputs, candidates, works, memberships, sources, search records, immutable
      observations, operations, attempts, rejections, and migration records. Include foreign keys,
      identity and association uniqueness, operation target constraints, and sequence/index support
      for bounded reads.
- [x] T005 Implement storage opening, transactions, explicit migration execution, and startup schema
      verification in `apps/search/src/db.ts` after T003-T004. Verify foreign keys, WAL, and
      `synchronous=FULL`; roll back failed upgrades, reject changed migration checksums and unknown
      newer schemas, and never recreate a database on error. Use the same path for migration and
      runtime entrypoints.
- [x] T006 Implement the loopback server and `GET /health` in `apps/search/src/server.ts`: validate
      Host, reject browser Origin/cross-site requests, enforce JSON mutations and the 16 KiB body
      limit, and return safe structured errors with correct status codes. Storage failure prevents
      readiness; provider readiness is separate. Keep database errors visible and exclude raw
      exceptions, provider bodies, and credentials from output.
- [x] T007 Add foundational checks in `apps/search/tests/search.test.ts` with temporary databases
      and test-only configuration: migration rollback, checksum/newer-schema rejection, preserved
      committed rows, path consistency, missing credentials/policy,
      loopback/Host/Origin/content-type/body-size controls, and fake-secret redaction. Run them and
      fix failures before story work.

**Checkpoint**: Storage and local access checks pass. A missing live permission basis blocks
provider execution without blocking saved reads. No search or identity claims are made yet.

## Phase 3: User Story 2 - Resolve ambiguous titles explicitly (Priority: P1)

**Goal**: Submit titles, inspect candidates, and persist explicit selections without researching an
unconfirmed or substituted work.

**Independent test**: Submit ambiguous, singleton, conflicting, and unmatched inputs; inspect and
select candidates through the API. Assert zero search dispatches until all inputs resolve and
exactly one queued search per distinct work after the final selection. US1 supplies search
execution.

### Tests

- [x] T008 [P] [US2] Add sanitized TMDB fixtures in `apps/search/tests/fixtures/tmdb.json` and
      provider checks in `apps/search/tests/providers.test.ts` for remakes,
      translated/alternative-title matches, movie/TV numeric-ID collisions,
      missing/invalid/conflicting dates, one versus two search requests, deterministic capped
      interleaving, and failure of either required search. Assert exact endpoint/query/Bearer
      authentication, exclusion of adult results, atomic candidate publication, and no retained
      overviews, images, raw responses, or fabricated revisions. Assert `redirect: "error"` and
      verify with local redirect endpoints and a fake token that the operation fails without any
      request reaching the redirect destination.
- [x] T009 [P] [US2] Add submission and selection contract checks in
      `apps/search/tests/search.test.ts`: invalid/empty/over-limit inputs cause no writes or
      provider calls, 20 inputs succeed, singleton candidates still require confirmation, decline
      remains unresolved, wrong-input/ineligible/duplicate selections and partially invalid batches
      preserve state, and concurrent final selections freeze once with one operation per distinct
      work.

### Implementation

- [x] T010 [US2] Implement bounded TMDB resolution in `apps/search/src/providers/tmdb.ts` using
      injected fetch and movie/TV search-result metadata as specified in `contracts/providers.md`.
      Enforce namespaced provider identities, local year eligibility, response validation, the
      20-candidate cap, per-endpoint coverage, metadata policy, and safe failures. Make one call for
      a supplied type or two when omitted; require both to succeed before publication, never hydrate
      details or auto-select a candidate.
- [x] T011 [US2] Implement request submission, candidate publication, selection, and decline in
      `apps/search/src/search.ts`. Validate the entire submission before mutation; preserve original
      inputs; reuse work identities by provider/media-type/ID while keeping local UUIDs and
      first-selected snapshots; atomically validate selection ownership, freeze the fully resolved
      set, and queue one search operation per distinct work. Preserve duplicate input mappings,
      allow reselection before freeze, and reject changes after freeze or capacity overflow without
      partial writes.
- [x] T012 [US2] Implement durable resolution dispatch in `apps/search/src/worker.ts`:
      transactionally claim one pending operation, create a unique attempt with a 60-second
      deadline, make external calls outside transactions, and publish candidates or safe failures
      only while that attempt still owns the running operation and is unexpired. Wire resolution to
      `src/providers/tmdb.ts` and `src/search.ts`; do not claim search operations until their
      handler is added in T019.
- [x] T013 [US2] Wire submission, request summary, candidate listing, and selection routes in
      `apps/search/src/server.ts` to `apps/search/src/search.ts` with the exact response/status
      semantics in `contracts/search-api.md`. Add scoped cursor pagination for candidates and expose
      unresolved reasons, eligibility, provenance, coverage caps, and required actions; start the
      resolution worker after readiness. Candidate pagination is superseded by T037.
- [x] T014 [US2] Run the US2 checks in `apps/search/tests/providers.test.ts` and
      `apps/search/tests/search.test.ts`; verify selection survives database reopen, unsafe
      selections leave all prior state unchanged, and final selection queues search exactly once.
      Record the result and implementation revision in `docs/specs/001-search/quickstart.md` without
      claiming live identity quality.

**Checkpoint**: The resolution/selection workflow is independently testable. Search operations are
durable but remain pending until US1 is implemented; this is not the search MVP.

## Phase 4: User Story 1 - Search for sources about selected works (Priority: P1)

**Goal**: Execute bounded search for confirmed works and inspect persisted results after restart.

**Independent test**: Follow documented setup, submit and confirm three titles spanning film and
television, discover sources including one shared source, and reopen storage to read the same
references without provider calls. Live setup timing remains a separate acceptance measurement.

### Tests

- [x] T015 [P] [US1] Add Exa fixtures in `apps/search/tests/fixtures/exa.json` and checks in
      `apps/search/tests/providers.test.ts` for exact Search request keys, one query per selected
      work, valid empty results, caps, safe URL validation/normalization, and injected
      text/highlights/summary/raw errors that must never reach returned metadata. Assert no
      Contents, synthesis, or unselected-work requests. Assert `redirect: "error"` and reuse the
      local redirect check with a fake `x-api-key`, proving failure without any request reaching the
      redirect destination.
- [x] T016 [P] [US1] Add the complete submit-select-search-read acceptance flow in
      `apps/search/tests/search.test.ts`: shared sources across works, aliases resolving to one
      membership, separate repeated requests, preserved query/rank/time observations, independent
      title-identical URLs, bounded complete pagination, and identical saved reads after database
      reopen without credentials or network calls, while retaining provider metadata approval.

### Implementation

- [x] T017 [US1] Implement Exa Search in `apps/search/src/providers/exa.ts` using injected fetch and
      the exact metadata-only request/response contract. Construct one query from each frozen work
      selection, require provider approval for the fixed metadata fields and retain safe notices
      only, validate and normalize public HTTP/HTTPS source locations without fetching them,
      classify provider/response failures, and expose returned/retained/rejected counts and limit
      indicators.
- [x] T018 [US1] Implement atomic search publication in `apps/search/src/search.ts`: reuse
      normalized source identities, retain per-attempt observations and all request/work
      associations, save safe rejected-result reasons, and mark success only after all local writes
      commit. Validate attempt ownership/deadline and selected-work membership; roll back storage
      failures, never add unselected works, and never merge different URLs by title.
- [x] T019 [US1] Extend `apps/search/src/worker.ts` with the search handler using
      `src/providers/exa.ts` and `src/search.ts`. Run one external call at a time with bounded
      response consumption, persist successful empty outcomes distinctly from failures, and preserve
      completed operations across process restart. Wire clean startup/shutdown in
      `apps/search/src/server.ts`; active cancellation becomes interrupted rather than successful.
- [x] T020 [US1] Add saved request listing, selected works, collection sources, and stable
      work/source detail reads in `apps/search/src/search.ts` and their routes in
      `apps/search/src/server.ts`. Use scoped snapshot/keyset pagination with 1-100 rows, reject
      malformed/mismatched cursors, include all work associations, and read only persisted records
      with current provider approval and explicit candidate/unknown-rights markers. Missing approval
      blocks metadata reads; missing credentials do not. Use the fixed adapter metadata contract.
- [x] T021 [US1] Replace the starter instructions in `README.md` with actual install, configuration,
      permission-policy, stopped-server migration, startup, confirmation, and saved-read examples
      matching `docs/specs/001-search/quickstart.md`. Run the US1 provider/integration checks in
      `apps/search/tests/providers.test.ts` and `apps/search/tests/search.test.ts`; record results
      without presenting fixture relevance or timing as live acceptance.

**Checkpoint**: US2 plus US1 deliver the first usable search increment. All inputs require
confirmation, metadata remains bounded and permitted, and saved results survive restart. US3 and US4
remain required for full feature completion.

## Phase 5: User Story 3 - Inspect incomplete search and retry failures (Priority: P2)

**Goal**: Make failures and interruptions inspectable and retry only failed or unfinished work.

**Independent test**: Succeed for one work and fail another; inspect and retry only the failure.
Kill/restart a child runtime during a held operation, observe interruption after its deadline, and
prove that retry preserves completed results and stale attempts cannot publish.

### Tests

- [ ] T022 [P] [US3] Add recovery checks in `apps/search/tests/recovery.test.ts` using a child
      runtime, controlled provider responses, and a temporary persistent database: kill during a
      call, restart, expire the original attempt, resume pending work, and retry interrupted work.
      Separately release a delayed response from an expired attempt in a surviving worker to prove
      it cannot overwrite a newer attempt; a response from a killed process cannot be released.
      Check graceful cancellation and surviving committed IDs/results.
- [ ] T023 [P] [US3] Add status/retry contract checks in `apps/search/tests/search.test.ts` for
      partial success, provider-empty versus all-rejected results, resolution failures, rate limits,
      Retry-After/fallback delays, wrong-request or active/completed operation IDs, early retries,
      duplicate retries, and local-capacity rejection. Assert failures never become successful empty
      searches and completed calls/results never repeat.

### Implementation

- [ ] T024 [US3] Implement failure retry and derived request/per-work status in
      `apps/search/src/search.ts` following `data-model.md`. Preserve all required actions and
      failures independently of summary precedence; validate explicit operation lists atomically,
      queue only due failed/interrupted operations, keep unresolved title searches out of technical
      retries, enforce capacity, and retain closed attempts and successful results.
- [ ] T025 [US3] Complete recovery in `apps/search/src/worker.ts` and saved status reads in
      `apps/search/src/search.ts`: sweep expired attempts once per second and at startup, interpret
      expired running work as interrupted on reads, resume pending work, and require explicit retry
      for interrupted work. Honor provider retry times with no automatic retries and preserve
      attempt-ownership checks on every late success/failure write.
- [ ] T026 [US3] Expose retry in `apps/search/src/server.ts` using `apps/search/src/search.ts`. Keep
      affected operation/input/work IDs, safe errors, counts, retry times, and next actions in
      request summaries. Dedicated operation-list, attempt-history, and rejection-history endpoints
      are deferred. Match `contracts/search-api.md` status codes; readable failures remain distinct
      from HTTP/storage failures.
- [ ] T027 [US3] Run `apps/search/tests/recovery.test.ts` and the retry/status cases in
      `apps/search/tests/search.test.ts`; record restart, stale-response, and selective-retry
      evidence in `docs/specs/001-search/quickstart.md`. Document the possible repeated provider
      charge after a crash before local commit without claiming exactly-once provider execution.

**Checkpoint**: Failed work is recoverable without duplicating completed associations. No stale
attempt can publish and no request remains permanently running after processing has stopped.

## Phase 6: User Story 4 - Assess source candidates before ingestion (Priority: P2)

**Goal**: Inspect complete search provenance, incomplete/restricted metadata, and unverified work
relevance without implying content rights or established evidence.

**Independent test**: Inspect a multi-work source and sources with missing/restricted metadata.
Traverse source observations and inspect summary failures and rejection counts. Withdraw provider
approval and confirm metadata reads fail with 503 while local inputs, selections, IDs, counts, and
status remain readable.

### Tests

- [ ] T028 [P] [US4] Extend `apps/search/tests/providers.test.ts` with restrictive response/result
      notices, unreviewed policy, missing/invalid/oversized optional fields, unknown bounded notice
      codes, and unexpected content fields. Assert fail-closed retention, explicit null/warning
      handling, safe error redaction, and unknown source-content permissions without fetching source
      pages.
- [ ] T029 [P] [US4] Extend `apps/search/tests/search.test.ts` with provenance reads for shared
      sources, original request observations after later searches, paginated source observations,
      rejection counts, and historical provider-approval gating. Assert query/rank attribution,
      explicit missing metadata, no fabricated publisher, no exposed raw URLs in rejection records,
      and no bodies, claims, or inferred rights in storage/logs/output.

### Implementation

- [ ] T030 [US4] Complete source-observation queries in `apps/search/src/search.ts` and expose their
      routes in `apps/search/src/server.ts`, with optional request filtering. Return stable
      identity, selected-work links, search origin/time/query/rank/notices, and bounded observations
      joined to their internal attempts. Preserve original request observations and enforce provider
      approval on every metadata read. Keep rejection counts and safe failure context in summaries;
      dedicated attempt and rejection history endpoints remain deferred.
- [ ] T031 [US4] Complete and verify the metadata edge cases in `apps/search/src/config.ts`,
      `apps/search/src/providers/tmdb.ts`, and `apps/search/src/providers/exa.ts`: reject
      restrictive provider notices, null invalid optional values with safe warnings, use fixed
      metadata fields, and block calls/metadata reads without provider approval. No policy may
      enable source text or synthesis. Run the US4 checks in `apps/search/tests/providers.test.ts`
      and `apps/search/tests/search.test.ts` and record evidence in
      `docs/specs/001-search/quickstart.md`.

**Checkpoint**: Every saved candidate is assessable with provenance and uncertainty intact. No
source ingestion, extraction, or permission inference is introduced.

## Phase 7: Polish and cross-cutting acceptance

**Purpose**: Verify the whole deliverable, its setup instructions, and live acceptance separately.

- [ ] T032 [P] Add the predeclared ten-work corpus and relevance rubric in
      `apps/search/tests/fixtures/live-corpus.json` and the opt-in evaluator in
      `apps/search/tests/live-acceptance.test.ts`. Include TMDB media-type/ID identities,
      film/series, remakes, and aliases; require explicit live opt-in, reviewed metadata policy,
      credentials, and recorded human relevance judgments. Version the corpus before running;
      missing judgments/evidence must not count as a pass, and ordinary tests must exclude this
      suite.
- [ ] T033 [P] Reconcile `README.md` and `docs/specs/001-search/quickstart.md` with implemented
      commands, endpoints, limits, startup/recovery behavior, and permission-policy setup. Add
      operator credits with the approved TMDB logo and required attribution notice linked from
      provider provenance. Keep credentials out of examples and retain distinct planned,
      deterministic, and live evidence labels. Remove obsolete claims about nonexistent runtime
      components only after checking actual files.
- [ ] T034 Run the complete deterministic suites in `apps/search/tests/search.test.ts`,
      `apps/search/tests/providers.test.ts`, and `apps/search/tests/recovery.test.ts`, app
      `check-types`, repository lint, and formatting checks. Fix failures in their owning files,
      verify no accidental production dependencies or unrequested features, and record
      commands/results/revision in `docs/specs/001-search/quickstart.md`.
- [ ] T035 Verify actual provider retention/display permission for the complete fixed metadata
      contract and record references, revision, and review dates in
      `apps/search/metadata-policy.json` before any live retention. If account permission evidence
      is unavailable, leave the affected provider disabled and record the exact blocker in
      `docs/specs/001-search/quickstart.md`; fixtures are not permission evidence.
- [ ] T036 Execute fresh-checkout setup and the live workflow in
      `docs/specs/001-search/quickstart.md` after T032-T035, using
      `apps/search/tests/live-acceptance.test.ts` and the unchanged versioned corpus. Record setup
      time, correct identities for all ten works, reviewer relevance for at least nine, permitted
      references, limits/failures, and SC-001 through SC-006 as PASS, FAIL, or NOT RUN with
      evidence. Do not mark this task complete if required credentials, permission review, human
      scoring, or live execution is missing.

**Checkpoint**: Full completion requires all four stories and acceptance evidence. Fixture passes
cannot establish live relevance, account permissions, or the 30-minute fresh-checkout target.

## Simplification after Phase 3

This pass changes the current code and future contracts only. Existing Phase 3 evidence remains
historical; Exa execution, source reads, retry/recovery, live review, and acceptance stay unchecked.

- [x] T037 Return the current attempt's at most 20 candidates in ordinal order, without pagination.
      Reject query parameters through `noQuery`; preserve internal history and selection ownership.
- [x] T038 Replace configurable field lists with provider approval for the fixed metadata contract.
      Gate calls and saved metadata reads, reject legacy policies, and keep local status readable.
- [x] T039 Define the greenfield schema in the single initial migration without limits snapshots.
      Remove the duplicated schema inventory, retaining compatibility, integrity, and transactions.
- [x] T040 Update tests, fixtures, feature docs, and future tasks. Verify fresh initialization and
      migration rollback, current candidates, provider gating, app tests/type-check, lint, format,
      and diff. Record fresh evidence separately; do not implement or claim later-phase acceptance.

## Dependencies and execution order

```text
Setup T001-T002
  -> Foundation T003-T007
  -> US2 T008-T014
  -> Simplification T037-T040
  -> US1 T015-T021
  -> US3 T022-T027
  -> US4 T028-T031
  -> Acceptance T032-T036
```

- The simplification pass follows Phase 3 and does not authorize later-phase implementation.
- Phase barriers are mandatory. Within each phase, follow task order except the explicitly
  independent groups below. Every task depends on the prior phase checkpoint.
- T003 and T004 can run together; T005 requires both. T006 follows storage/configuration, and T007
  verifies the complete foundation.
- Within each story, the two initial test tasks can run together. Implementation begins after both
  have defined the expected contracts. Run the story's checks before leaving its phase.
- US2 is a real prerequisite for US1. US3 builds on search attempts and outcomes. US4 follows US3 so
  its inspection can join source provenance to internal attempts and saved failure outcomes. Do not
  claim story-level parallelism across their shared `search.ts`, `server.ts`, or test files.
- T032 and T033 can run together after all stories. T034 validates the final code/docs; T035
  establishes live permission evidence; T036 requires all earlier acceptance tasks.
- Do not commit unrelated existing changes. The live corpus must be fixed in version control before
  live evaluation as required by `quickstart.md`; commit only the intended corpus/rubric when
  preparing that evaluation.

## Parallel execution examples

These are scheduling examples, not commands to spawn agents automatically.

| Stage      | Tasks that can run together | Separation                                                     |
| ---------- | --------------------------- | -------------------------------------------------------------- |
| Setup      | T001 and T002               | Package/lock/config files versus env example and ignore rules  |
| Foundation | T003 and T004               | Runtime configuration/policy versus SQL schema                 |
| US2        | T008 and T009               | TMDB fixtures/provider tests versus submission/selection tests |
| US1        | T015 and T016               | Exa fixtures/provider tests versus persistence/API tests       |
| US3        | T022 and T023               | Child-process recovery tests versus status/retry tests         |
| US4        | T028 and T029               | Provider metadata tests versus saved inspection tests          |
| Acceptance | T032 and T033               | Live suite/corpus versus operator documentation                |

## Requirement coverage

| Requirements     | Primary tasks                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| FR-001 to FR-004 | T008-T014, T037, T040: bounded input, stable identity, explicit selection, atomic freeze                     |
| FR-005 to FR-007 | T015-T020: selected-work search, metadata/provenance, identity reuse                                         |
| FR-008           | T013, T020-T021, T026, T030: complete developer interface and saved reads                                    |
| FR-009 to FR-010 | T022-T027: coverage/status, failure reasons, retries and restart                                             |
| FR-011           | T004-T005, T011-T012, T018-T020, T022-T027: durable records and outcomes                                     |
| FR-012           | T001-T007, T021, T033-T036, T039-T040: configuration, migrations and local setup                             |
| FR-013           | T003, T008-T020, T023-T026, T030: finite limits and complete bounded reads                                   |
| FR-014 to FR-016 | T002-T003, T006-T010, T015-T017, T028-T031, T035, T038, T040: metadata rights, safe local access and secrets |
| SC-001           | T021, T033, T036: timed fresh-checkout three-title workflow                                                  |
| SC-002           | T032, T035-T036: fixed ten-work live corpus and recorded relevance judgments                                 |
| SC-003           | T008-T014, T015-T019: unresolved inputs cannot trigger unconfirmed/expanded search                           |
| SC-004           | T016, T018-T020, T022-T027: stable references, deduplication and recovery                                    |
| SC-005           | T022-T027, T030: inspectable coverage and selective retry                                                    |
| SC-006           | T015-T020, T028-T031, T034-T036: provenance and metadata-only evidence                                       |

## Implementation strategy

1. Complete setup and foundation with the existing modules and dependencies.
2. Deliver and verify US2's selection workflow, then US1's persisted search. This is the MVP for
   local demonstration; ambiguity protections and permission checks remain active throughout.
3. Add and verify US3 recovery, then US4's complete candidate inspection. Reuse earlier behavior and
   tests rather than implementing separate write paths.
4. Run deterministic validation once the final changes are integrated. Record live evidence
   separately; report missing access or permissions as blockers, not successful empty runs.

Keep every task unchecked until its work and specified checks are complete. Do not add application
pages, source bodies, extraction, public accounts, or deployment work to this feature.
