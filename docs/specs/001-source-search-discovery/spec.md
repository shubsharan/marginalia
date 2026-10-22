# Feature Specification: Source search and discovery

**Feature Branch**: `feat-001-source-search-discovery`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "docs/roadmap.md #1, Source search and discovery"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Discover sources for selected works (Priority: P1)

A developer submits a collection of film or television titles and inspects the resolved works and
external sources relevant to researching them together. Saved results remain available after local
restart, without application pages.

**Why this priority**: This delivers roadmap feature 1 and gives later research features identified
works and inspectable source candidates.

**Independent Test**: From a fresh checkout, follow local startup instructions, submit three
unambiguous titles spanning film and television, and inspect the saved works and sources. Restart
locally and inspect the same results by their saved references.

**Acceptance Scenarios**:

1. **Given** a fresh checkout and documented prerequisites, **When** the developer follows setup
   instructions, **Then** they can initialize storage, start locally, submit titles, and inspect
   results without application pages or manual changes to stored records.
2. **Given** several unambiguous titles, **When** the developer submits them, **Then** each original
   input maps to its resolved work, and source candidates are associated with the selected works and
   their collection.
3. **Given** a source returned for multiple selected works, **When** the developer inspects the
   collection, **Then** one source identity retains all those associations and their discovery
   provenance.
4. **Given** saved results, **When** the runtime restarts, **Then** the same request, work
   identities, source identities, and associations remain readable without repeating searches.

---

### User Story 2 - Resolve ambiguous titles explicitly (Priority: P1)

A developer distinguishes remakes, similarly named works, and film versus television matches before
discovery begins. They inspect candidates and choose the intended work.

**Why this priority**: Discovering sources for the wrong work would undermine later research.
Uncertainty must remain visible at selection.

**Independent Test**: Submit an ambiguous title, inspect the candidates, and select one. Verify that
discovery begins only after every input in the collection is resolved.

**Acceptance Scenarios**:

1. **Given** an ambiguous title, **When** resolution returns multiple plausible works, **Then** the
   request requires caller selection and exposes distinguishing candidate details. Discovery has not
   started for the collection.
2. **Given** a pending selection, **When** the caller selects a candidate belonging to that input,
   **Then** the system saves the choice and its stable work reference. Discovery can proceed once
   every input is resolved.
3. **Given** no match or no acceptable candidate, **When** the caller inspects the request or
   declines the candidates, **Then** the input remains explicitly unresolved with guidance to submit
   a clarified title. The system does not invent a work or select a substitute.
4. **Given** an invalid candidate selection, **When** the caller submits it, **Then** the system
   explains the rejection and preserves the prior state.

---

### User Story 3 - Inspect incomplete discovery and retry failures (Priority: P2)

A developer distinguishes a completed search with no results from a failed or unstarted search. They
can retry failures while keeping successful results available.

**Why this priority**: External failures must not hide coverage gaps or force the developer to lose
useful results.

**Independent Test**: Make discovery succeed for one selected work and fail for another. Inspect and
retry the failed portion, confirming successful results and identities remain intact.

**Acceptance Scenarios**:

1. **Given** a completed search with no usable results, **When** the caller inspects the request,
   **Then** that work is marked as searched with no sources found, distinct from failed or pending.
2. **Given** a timeout, access failure, or service limit during resolution or discovery, **When**
   the caller inspects progress, **Then** the failed operation, affected inputs or works, and useful
   reason are visible. Completed results remain readable and the request does not report full
   success.
3. **Given** a failed operation, **When** the caller retries after addressing the cause, **Then**
   only failed or unfinished work is repeated. Completed results survive without duplicate
   associations.
4. **Given** interrupted processing, **When** the runtime restarts, **Then** saved progress remains
   inspectable and unfinished work can resume or be retried. It cannot remain indefinitely marked as
   actively running when no processing is taking place.

---

### User Story 4 - Assess source candidates before ingestion (Priority: P2)

A developer inspects where sources came from and which selected works they may concern. They can
pass stable references to later ingestion work without mistaking discovery for verified evidence or
permission to reuse content.

**Why this priority**: Source candidates need enough context to assess relevance and preserve
provenance.

**Independent Test**: Inspect a saved source associated with multiple works and one with incomplete
metadata. Verify usable locations, discovery provenance, and explicit missing information.

**Acceptance Scenarios**:

1. **Given** a discovered source, **When** the caller inspects it, **Then** they see its stable
   reference, location, available descriptive metadata, selected-work associations, and when and
   through which search it was found.
2. **Given** missing author, publication date, or relevance information, **When** results are shown,
   **Then** missing information is explicit and is not fabricated.
3. **Given** a source also mentioning an unselected work, **When** results are saved, **Then** that
   work is not added to the collection or automatically researched.
4. **Given** discovered sources, **When** the caller inspects results, **Then** they are identified
   as candidates for later assessment. No source body, extracted claim, or inferred permission is
   presented as a result of this feature.

### Edge Cases

- Empty submissions, blank titles, malformed optional details, and requests exceeding the documented
  collection limit are rejected with input-specific errors before any external search begins.
- Repeated titles or aliases resolving to the same work preserve original input mappings but produce
  one collection membership. A shared title alone does not merge distinct works.
- Optional year and work type narrow resolution. Conflicting details remain unresolved rather than
  being silently ignored. Missing candidate details are displayed as unknown.
- Repeated source locations reuse an identity. Different locations are not merged merely because
  their titles match. Missing or unusable locations are reported as rejected results.
- Reaching a discovery limit is reported as bounded coverage, not exhaustive research. Saved results
  can be read in bounded portions without losing access to the rest.
- Changing a resolved work after discovery begins requires a new request, preserving the meaning of
  the original request and its source associations.
- Missing configuration blocks the affected operation with an actionable error. Failed storage
  initialization or upgrades do not report readiness or discard existing records.
- Credentials never appear in saved discovery results or ordinary error output.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST accept a caller-selected collection of film or television titles with
  optional year and work type, preserving original inputs. It MUST support at least ten input titles
  per request and reject invalid submissions as described in Edge Cases.
- **FR-002**: The system MUST resolve inputs to stable work identities with a title, work type,
  available distinguishing details, and identity provenance. Repeated resolution of the same known
  work MUST reuse its identity without merging works solely by title.
- **FR-003**: The system MUST expose ambiguous matches for explicit caller selection. Unmatched
  inputs and declined candidates MUST remain unresolved. Selections MUST belong to the candidates
  for that input and be retained with the request.
- **FR-004**: Discovery MUST start only when every input has a resolved work. The selected work set
  MUST remain fixed after discovery starts; changing it requires another request. Discovery MUST NOT
  automatically expand the collection to other works.
- **FR-005**: The system MUST discover external source candidates for the resolved collection and
  associate them with the selected works they may concern. A source MAY concern multiple selected
  works. These associations MUST NOT assert verified relationships between works.
- **FR-006**: Every retained source MUST have a stable identity and usable external location.
  Inspection MUST include available title, author or publisher, and publication date, with missing
  values explicit. It MUST also expose discovery time, search origin, search terms or equivalent
  context, and any available relevance basis, attributed to its origin.
- **FR-007**: Repeated discovery of a known source location MUST reuse its identity while retaining
  discovery provenance and work associations. Retries and repeated requests MUST NOT create
  duplicate work memberships or source associations within a request. Different requests MUST remain
  separately inspectable.
- **FR-008**: Callers MUST be able to submit, inspect progress, select candidates, retry failures,
  and read saved works and sources through a documented developer interface without application
  pages. Saved references MUST retrieve the same records after restart.
- **FR-009**: Inspection MUST distinguish unresolved inputs, required caller actions, pending and
  running operations, completed searches with or without sources, failures, and interruptions.
  Collection progress MUST expose incomplete coverage rather than imply full success.
- **FR-010**: Failures MUST identify the affected operation and an actionable reason. Retries MUST
  preserve completed results and repeat only failed or unfinished work. Interrupted requests MUST
  become resumable or retryable after restart.
- **FR-011**: The system MUST persist requests, resolution choices, work and source identities,
  associations, discovery provenance, and operation outcomes. Saved results MUST remain inspectable
  without contacting external services again.
- **FR-012**: Local setup MUST document prerequisites, required configuration, storage
  initialization and upgrades, startup, and example submission and inspection. Missing configuration
  and failed storage initialization or upgrades MUST fail visibly without reporting readiness or
  discarding existing saved results.
- **FR-013**: Discovery and inspection MUST have documented finite limits. Callers MUST be able to
  identify when discovery reached a limit and read all saved results in bounded portions. Failures
  MUST NOT be converted into successful empty searches.
- **FR-014**: This feature MUST retain and expose only discovery metadata permitted for those uses.
  It MUST NOT fetch or retain source bodies, request full source content during discovery, or
  extract claims. Discovery and attribution MUST NOT imply permission to process, quote, or
  republish a source. Unknown permissions MUST remain unknown for later ingestion assessment.
- **FR-015**: Results MUST distinguish source candidates and unverified relevance information from
  established evidence. Missing metadata MUST NOT be invented. Results rejected for unusable source
  locations MUST be visible in the discovery outcome.
- **FR-016**: The initial workflow MUST be operable by a trusted developer locally without public
  accounts or a graphical interface. Configuration secrets MUST be excluded from saved discovery
  records and ordinary output.

### Key Entities _(include if feature involves data)_

- **Discovery request**: One caller-selected collection, its original inputs, fixed resolved work
  set, limits, progress, and saved results.
- **Title input and resolution**: Supplied title and optional details, candidate matches, unresolved
  status or chosen work, and the basis for resolution.
- **Work**: A stable film or television identity with distinguishing metadata and identity
  provenance, reusable across requests.
- **Source**: A stable external source identity, location, descriptive metadata, and any known
  restrictions on retained discovery metadata. Its content has not been ingested.
- **Discovery record**: A source's association with a request and one or more selected works,
  including search origin, time, context, and available relevance information.
- **Operation outcome**: Resolution or discovery progress and results, including affected inputs or
  works, failure information, and retry status.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer with documented prerequisites and service access can go from a fresh
  checkout to inspecting saved results for three titles spanning film and television within 30
  minutes, using only the documented workflow.
- **SC-002**: In an acceptance collection of ten unambiguous titles with known discoverable sources,
  every title resolves to the intended work and at least nine works have one source a reviewer
  judges relevant to researching that work. Every retained source has an inspectable location and
  discovery origin. The evaluation collection and relevance rubric are recorded before the run.
- **SC-003**: All acceptance cases involving ambiguous, unmatched, or conflicting inputs remain
  explicit until resolved. No such case starts discovery with an unconfirmed work, and no acceptance
  case adds an unselected work.
- **SC-004**: Across restart, retry, and repeated-submission acceptance cases, all saved references
  remain usable, with zero duplicate work memberships or source associations within a request and no
  loss of completed results.
- **SC-005**: For every tested empty result, failure, partial completion, interruption, and limit
  reached, the caller can identify coverage and the next action from saved status. Failed work can
  complete after retry without repeating completed work.
- **SC-006**: Every source inspected in acceptance testing exposes its selected-work associations
  and discovery provenance. No result contains a retrieved source body, extracted claim, fabricated
  metadata, or permission inferred merely from discovery.

## Assumptions

- Scope follows [roadmap feature 1](../../roadmap.md#1-source-search-and-discovery), constrained by
  [product](../../product.md), [architecture](../../architecture.md), and the
  [constitution](../../../.specify/memory/constitution.md). No earlier backend feature is required.
- The caller is a trusted developer running locally. Public hosting, sign-in, native publishing,
  curation, and application pages belong to later features.
- Film and television series identities are the initial resolution targets. Separate season,
  episode, scene, and timestamp targeting is outside this feature.
- A collection waits for all title resolutions before discovery. Callers submit a new request to
  correct an unmatched title or change the work set, keeping prior requests inspectable.
- External identity and search services require network access and any documented credentials.
  Providers, storage, runtime, migration mechanisms, and interface protocols are selected during
  planning. This specification does not adopt choices from an earlier research plan.
- Discovery stores permitted metadata and references only. Rights-aware retrieval, retention of
  source material, complaint handling, and processing-versus-display decisions belong to feature 2.
  Extraction belongs to feature 3, and full knowledge queries and deployment belong to feature 4.
- Discovery is bounded search, not a claim to find every relevant source. Candidates can support
  research across selected works without proving a claim or relationship.
- Timing and relevance criteria are acceptance targets for implementation, not current behavior
  claims or guarantees of third-party availability.
