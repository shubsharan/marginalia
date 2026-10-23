# Research decisions

Date: 2026-10-22. Scope: [search](spec.md), roadmap feature 1. These are implementation decisions,
not implemented behavior. The current repository has workspace tooling and shared TypeScript
configuration but no application runtime.

## Exa Search discovers source metadata

- Decision: Use native `POST https://api.exa.ai/search` through Bun's `fetch`. Send `query`,
  `type: "auto"`, and `numResults: 20`. Run one query per distinct selected work. Omit `contents`,
  `outputSchema`, and all synthesis options. Keep the request shape explicit in a contract test.
- Rationale: Search returns ranked locations and descriptive metadata. Twenty results per work is
  our bounded search budget. Exa has no result pagination, so inspection pagination reads SQLite.
  Source overlap across work queries records possible relevance to multiple selected works.
- Alternatives considered: `exa-js` adds no necessary behavior for this single endpoint. Deep
  search, generated relevance explanations, and pairwise searches add processing or cost without a
  requirement. The application does not need a second search provider.

The [Search reference](https://exa.ai/docs/reference/search) and
[quickstart](https://exa.ai/docs/search/quickstart) describe optional content retrieval and bounded
results. Save only approved metadata fields, never the raw response. Missing publisher, author,
date, or score stays null. Result order and query are an unverified relevance basis, not confidence.
The [best-practices guide](https://exa.ai/docs/search/best-practices) documents
restriction-relaxation notices. Preserve their codes so a quoted title cannot be mistaken for an
exact-match guarantee.

## Other Exa products belong to different workflows

| Product                                                | Decision and rationale                                                                                                                                     | Alternative for this feature                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [Contents](https://exa.ai/docs/reference/get-contents) | Defer to feature 2. Fetching text or highlights violates FR-014 here. Later adoption requires checking source permissions and provider retrieval behavior. | Store source locations only.                |
| [Agent](https://exa.ai/docs/agent/quickstart)          | Defer. Multi-step research, verification, and enrichment read and synthesize sources.                                                                      | One bounded metadata search per work.       |
| [Answer](https://exa.ai/docs/reference/answer)         | Exclude. Generated answers are outside search.                                                                                                             | Expose original search provenance.          |
| [Snapshot](https://exa.ai/docs/search/snapshot)        | Defer until historical source content is needed and permitted.                                                                                             | Save immutable search observations locally. |
| [Monitors](https://exa.ai/docs/monitors/quickstart)    | Exclude. Recurring searches and webhook delivery are not requested, and runs synthesize findings.                                                          | Caller-triggered requests and retries.      |
| Websets and OpenAI-compatible endpoints                | Exclude. There is no existing integration to preserve or collection-enrichment requirement.                                                                | Native Search HTTP contract.                |

## TMDB supplies work identity

- Decision: Use TMDB movie and TV search through native fetch, as requested by the project owner.
  Search the supplied type or both types when omitted, keep bounded metadata snapshots, and require
  caller confirmation for every selection. No details hydration or second identity provider.
- Rationale: Dedicated movie/TV records avoid a local ontology-subclass allowlist. Search supports
  original, translated, and alternative titles. This is an implementation-fit decision, not a
  measured claim that TMDB resolves our corpus more accurately.
- Alternatives considered: Wikidata offers openly reusable structured metadata, but its general
  entity model adds classification work here. TVmaze does not cover films. Exa remains the source
  search provider, not the work identity authority. External-ID enrichment is deferred.

Use [movie search](https://developer.themoviedb.org/reference/search-movie) and
[TV search](https://developer.themoviedb.org/reference/search-tv) with the
[API Read Access Token](https://developer.themoviedb.org/docs/authentication-application) in a
Bearer header. Keep Marginalia UUIDs and enforce provider identity uniqueness on
`(tmdb, movie|tv, id)`. Retain title, original title, release/first-air date, language, available TV
origin countries, query origin, and retrieval time. Search responses do not supply a revision ID.

One page per required endpoint, at most 20 retained candidates per input, and at most two calls keep
resolution bounded. Untyped queries interleave movie and TV results; failure of either search fails
the whole input operation. Supplied years are checked locally against returned release or first-air
dates, preserving ineligible candidates for inspection. No regional-release expansion, adult
results, details requests, credits, or image retrieval are included. The provider contract specifies
exact ordering, date semantics, limits, validation, and failure handling.

The [TMDB FAQ](https://developer.themoviedb.org/docs/faq) describes attribution for free
noncommercial use and separate commercial licensing. Its metadata is not CC0. Actual account terms
and retention/display permission must be recorded before live use; selecting the provider does not
establish that review. Required attribution belongs in the operator documentation and provider
provenance. These licensing conditions do not confer rights over research-source content.

## Bun and SQLite provide the local runtime

- Decision: Add one `apps/search` workspace using repository-pinned Bun 1.4.2 and TypeScript 7.0.2.
  Use `Bun.serve`, `bun:sqlite`, native `fetch`, and `bun:test`. Reuse shared TypeScript settings
  and the installed formatter and linter. On 2026-10-23, the owner requested Hono for routing, Zod
  for boundary schemas, and neverthrow for expected provider failures. These replace the earlier
  decision to avoid all production packages. No ORM, queue service, or general provider layer is
  added.
- Rationale: The trusted local developer needs durable writes and JSON reads. Bun includes the
  required [HTTP server](https://bun.sh/docs/runtime/http/server) and
  [SQLite driver](https://bun.sh/docs/runtime/sqlite). A single application owns the workflow.
- Alternatives considered: PostgreSQL adds a service before shared hosting is required. Separate API
  and worker packages add deployment boundaries without a user benefit. A CLI alone complicates
  interactive selection while long-running work is active.

Use foreign keys, WAL, and `synchronous=FULL`, checking the effective values. SQLite documents the
durability tradeoff in its [PRAGMA reference](https://www.sqlite.org/pragma.html). Apply numbered
SQL migrations and their version records in transactions. Reject a newer unknown schema. Never
recreate storage on an upgrade error. Keep external calls outside write transactions.

Use neverthrow results at provider and body-reading boundaries. Keep transaction callbacks
exception-based: returning an error result is a normal return and would commit prior writes. The
deterministic suite verifies that a failing final-selection write rolls back the selection, work
identity, membership, and queued operation before Hono returns a safe storage error.

## Durable operations make retries precise

- Decision: Store one logical operation per input resolution or selected-work search, with
  append-only attempts. A single in-process worker claims pending operations transactionally. Each
  attempt has a deadline and unique ID. Completion commits only if that attempt still owns the
  operation.
- Rationale: A terminated process must not leave permanent running work. Expired attempts become
  interrupted and require explicit retry. Saved successful work never re-enters the queue. A late
  response cannot overwrite a retried attempt.
- Alternatives considered: An in-memory queue loses accepted work. Automatically retrying every
  failure hides cost and can repeat completed searches. An external workflow engine is unnecessary.

Use a 15-second timeout per external call and a 60-second operation deadline. Resolution makes one
typed search or two searches when type is omitted. Source search makes one Exa call. Use no
automatic provider retries. Save a retry time from `Retry-After` or a 30-second fallback for rate
limits and transient service failures. Map Exa's
[documented errors](https://exa.ai/docs/admin/error-codes) to safe local codes and guidance. Never
save provider error bodies, authentication headers, or arbitrary exception messages.

## Metadata rights and finite work

- Decision: Use an explicit provider metadata allowlist with a reviewed permission basis for
  retention and local display. Known restrictive result notices reject affected metadata. Page
  processing and display rights remain `unknown` on every candidate.
- Rationale: FR-014 requires permitted metadata, but a search result grants no source-content
  rights. Metadata policy is narrower than feature 2's source-ingestion policy.
- Alternatives considered: Saving arbitrary provider responses risks retaining prose or secrets.
  Treating attribution as permission contradicts the constitution. Building a general rights engine
  before ingestion exceeds this feature.

The implementation must record the actual provider terms or account permission basis in a small
metadata policy file before enabling live retention. This planning review does not establish those
permissions. Missing or unreviewed policy blocks affected provider work with
`metadata_policy_missing`. Saved reads use the current field allowlist, so disabling a field also
suppresses historical output. Only built-in metadata fields can be enabled. Policy cannot enable
source text or generated output.

## Verification and remaining evidence

All design choices are resolved. Use deterministic provider fixtures for ambiguity, limits,
failures, recovery, and metadata filtering. Run a separate live acceptance against a predeclared
ten-work corpus to measure relevance and resolution under SC-002. A fixture pass does not prove
provider quality.

Official documentation was reviewed on 2026-10-22. No live TMDB or Exa request was made during this
provider revision; credentials were not inspected. Live provider compatibility, account permissions,
relevance, startup timing, and crash recovery remain implementation acceptance checks, all currently
NOT RUN.
