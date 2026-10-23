# Implementation plan: Search

**Branch**: `feat-001-search` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: `docs/specs/001-search/spec.md`

Status: Tasks T001-T014 are implemented through Phase 3. TMDB resolution and explicit selection are
available; Exa execution and the remaining stories stay planned. Search operations remain pending
after selection until Phase 4. Spec Kit reports logical branch `001-search`; the actual Git branch
includes `feat-`.

## Summary

Build one local JSON API that resolves film and television titles through TMDB, waits for caller
confirmation, and queries Exa Search once per distinct selected work. Save source metadata, query,
rank, search time, and work associations in SQLite. Persist operation attempts so failures remain
inspectable and retryable without repeating completed work.

Exa Search is the only Exa product adopted here. Omit content retrieval and synthesis options.
[Research](research.md) explains why Contents, Agent, Answer, Snapshot, and Monitors do not fit
feature 1.

## Technical context

**Language/Version**: TypeScript 7.0.2 and Bun 1.4.2, matching the repository.

**Primary Dependencies**: Built-in `Bun.serve`, `bun:sqlite`, `fetch`, and `bun:test`; Hono 4.13.13
for routing and middleware, Zod 4.6.7 for boundary schemas, and neverthrow 8.2.0 for typed provider
outcomes. Shared `@repo/typescript-config` and Bun type declarations remain development
dependencies. `bun.lock` records the installed versions. The owner requested these additions on
2026-10-23 to replace handwritten plumbing.

**Storage**: Local SQLite, foreign keys, WAL, `synchronous=FULL`, numbered transactional SQL
migrations.

**Testing**: Provider fixtures, temporary databases, API contract tests, process restart tests, and
separate live acceptance.

**Target Platform**: Trusted local developer on macOS or Linux; loopback HTTP only.

**Project Type**: One backend workspace with an in-process worker.

**Performance Goals**: SC-001 setup and three-work inspection within 30 minutes; SC-002 relevant
sources for at least 9 of 10 predeclared works. Neither target has been measured.

**Constraints**: Metadata only; no source bodies, generated claims, automatic collection expansion,
public accounts, application pages, or deployment work.

**Scale/Scope**: 1-20 titles/request; 20 identity candidates/input; 20 source results/distinct work;
one active operation per worker; local reads capped at 100 rows/page.

No unresolved technical choices remain. Live relevance, account permissions, and measured recovery
behavior remain implementation acceptance prerequisites.

## Constitution check

Constitution version 3.0.0. Every gate passed before research and after design.

| Principle                               | Pre-research requirement                        | Post-design evidence                                                                              |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| I. Preserve meaning and context         | Stable identities and original mappings         | Namespaced TMDB IDs/local UUIDs and source URLs, frozen selections, per-attempt observations      |
| II. Evidence with room for disagreement | Search cannot become a claim                    | Unverified candidates, nullable fields, attributed rank and query                                 |
| III. Respect rights and privacy         | Metadata permission differs from content rights | Reviewed metadata allowlist, no content requests/raw payload storage, unknown source rights       |
| IV. Safe and accountable participation  | No publishing or public participation here      | Loopback JSON API with host/origin checks; contribution controls stay with their owning feature   |
| V. Build for an identified user need    | Complete roadmap feature 1 only                 | One application/database supports submit, select, inspect, retry, and restart                     |
| Verification and document ownership     | Planned behavior must be labeled                | Proposed commands and checks are explicit; product/architecture/roadmap/spec boundaries preserved |

No constitutional exceptions or amendments are needed.

## Workflow

1. Validate the entire submission before writes or provider calls. Atomically save the request,
   ordered inputs, and pending resolution operations; return `202` with a saved request ID.
2. Resolve and save candidate metadata. Require confirmation for singleton and ambiguous results.
   Declining or receiving no eligible candidate leaves that input unresolved.
3. Apply selections atomically, checking ownership and eligibility. Once every input resolves,
   freeze the set and queue one search operation per distinct work in the same transaction.
4. Run bounded Exa searches. Atomically save validated identities, observations, associations,
   rejected-result reasons, and successful outcomes. Failures remain visible operations.
5. Read saved results without provider calls. Retry failed/interrupted operations only. Recover
   expired attempts as interrupted; reject late responses from attempts that no longer own the work.

See the [data model](data-model.md), [API contract](contracts/search-api.md), and
[provider contract](contracts/providers.md) for state and interface rules.

## Project structure

### Design artifacts

```text
docs/specs/001-search/
  spec.md
  checklists/requirements.md
  plan.md
  research.md
  data-model.md
  contracts/search-api.md
  contracts/providers.md
  quickstart.md
  tasks.md
```

[tasks.md](tasks.md) contains the implementation sequence and acceptance checks.

### Planned source code

```text
apps/search/
  package.json
  tsconfig.json
  .env.example
  metadata-policy.json
  migrations/001_search.sql
  src/server.ts
  src/config.ts
  src/body.ts
  src/errors.ts
  src/db.ts
  src/search.ts
  src/worker.ts
  src/providers/tmdb.ts
  src/providers/exa.ts
  tests/fixtures/
  tests/body.test.ts
  tests/search.test.ts
  tests/providers.test.ts
  tests/recovery.test.ts
  tests/live-acceptance.test.ts
```

The foundation and US2 paths exist; Exa and later-story modules remain planned. The server owns HTTP
validation; search owns submit/select/retry/read; the worker dispatches persistent operations; the
database module owns migrations and transactions. Provider modules validate external responses. No
repository/service class layers are needed.

Hono owns route matching and shared access middleware. Zod validates submissions, selections,
pagination, policy, and provider metadata without exposing raw validation errors. A shared bounded
JSON reader enforces byte limits and strict UTF-8 for both HTTP and provider bodies. Provider
adapters return neverthrow results for expected failures; SQLite transaction callbacks still throw
on failure so rollback occurs before HTTP error handling. Candidate parsing stays in the provider
module. Request summaries join selected work IDs and derive status through ordered rules.

Implementation must also update workspace development dependencies and the Bun lockfile, replace the
starter README with actual setup, ignore database/WAL/SHM files, and add app scripts for `dev`,
`start`, `db:migrate`, `test`, `test:live`, and `check-types`. Reuse existing workspace globs,
TypeScript config, formatter, and linter. Direct app commands suffice; this plan requires no
Turborepo changes.

Add sanitized fixtures and a predeclared live corpus/relevance rubric. Planning preserves existing
dirty changes to the roadmap, specification, and requirements checklist and makes no commit.

## Validation coverage

| Requirements     | Proof required during implementation                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| FR-001 to FR-004 | Bounds, errors, aliases, confirmation, candidate ownership, conflicting details, atomic freeze, no expansion   |
| FR-005 to FR-007 | Per-work queries, shared source identity, complete provenance, deduplication, separate requests                |
| FR-008 to FR-011 | API operations, offline reads, empty/failure distinction, retries, restart, late-response rejection            |
| FR-012 to FR-013 | Setup, migration rollback, unknown schema rejection, missing config, finite limits, complete pagination        |
| FR-014 to FR-016 | Metadata-only requests, content filtering, policy, missing fields, unsafe URLs, secret redaction, local access |
| SC-001 to SC-006 | Timed setup, ten-work live evaluation, ambiguity, duplicates/restart, coverage, provenance audit               |

Use [quickstart.md](quickstart.md) for acceptance and [tasks.md](tasks.md) for foundational test
evidence. Full-feature acceptance remains NOT RUN.

## Complexity tracking

No gate violations. Persisted operations and attempts are necessary for retry/restart semantics. No
separate queue, ORM, graph database, LLM, or general provider framework is justified.
