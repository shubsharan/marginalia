# Development roadmap

[Product](product.md) · [Architecture](architecture.md)

Build the backend around external research and native publishing. Both produce a persisted,
queryable collection of media knowledge. Use that data to design the application, then extend how
people annotate, discuss, and discover it.

Each numbered deliverable owns a complete workflow, including its writes, reads, and failure
behavior. The initial backend capabilities are usable through commands or APIs without application
pages. Their later graphical interface is a separate deliverable, not a prerequisite for completing
those backend workflows. Search, retrieval, extraction, storage, and querying are implementation
tasks within research, not separate roadmap features.

The order below is the default delivery sequence. Only stated prerequisites are dependencies;
independent capabilities need not wait for unrelated work or business-validation gates. Feature IDs
are scope references, not delivery boundaries.

## Current baseline

The repository contains workspace tooling, shared TypeScript configuration, and Spec Kit setup.
Product runtime, persistence, and feature specs are not implemented. Everything below is planned.
Choose the stack, providers, concrete APIs, schemas, and extraction methods in feature plans.

## Initial backend deliverables

### 1. Research a collection of works

Input: A caller-selected set of film or television titles.

Requires: No existing product capability.

Owns the complete research workflow:

- Resolve the intended works, expose ambiguous matches for caller resolution, and discover relevant
  external sources. Research the selected works together; automatic expansion to other works is
  outside this deliverable.
- Retrieve permitted material, retain source identity and locations, and distinguish permission to
  process from permission to display. Expose source failures, retention rules, and source/copyright
  complaint handling. Broad ingestion requires the source-rights assessment and legal review.
- Extract observations, claims, concepts, genome properties, and typed relationships within and
  across those works. Preserve source passages or permitted references, extraction provenance,
  revisions, and conflicting interpretations. Expose unsupported results rather than treating them
  as established knowledge.
- Persist works and results with stable identities. Provide research submission, status, retry, and
  queries for works, sources, evidence, concepts, properties, and relationships. Repeated runs
  accumulate knowledge without blindly duplicating records or erasing disagreement.
- Include the runtime, persistence, migrations, configuration, authorized research operations, local
  startup, and deployable backend needed to run this workflow.

Output: A stored, inspectable knowledge collection with evidence-backed connections across works.

Complete when: From a fresh checkout, a developer researches several works, queries concepts they
share, and traces a relationship to supporting source material without an application UI. A failed
source is visible and retryable; rerunning does not duplicate published results. Ambiguous titles
and conflicting interpretations remain explicit.

Extraction can record source-backed concepts and relationships without waiting for automated
ontology proposal features. It does not silently settle contested meanings or merge canonical
concepts. Those changes use the maintenance and review capabilities below.

### 2. Publish and discuss native content

Input: User-authored reviews, analysis, and comments associated with existing works or
contributions.

Requires: Work identities, persistence, and extraction capabilities established by research.
Publishing does not require an external-source import for the contribution being published.

Owns the complete native publishing workflow:

- Provide operations to create, edit, publish, read, and withdraw reviews and analysis. Support
  comments on works and contributions, replies, and bounded conversation retrieval with original
  context preserved. Comments and replies have the same author-controlled edit and withdrawal
  lifecycle.
- Provide sign-in and sign-out, author identity, account controls, ownership checks, revision
  history, and publication status. Include reporting, moderator review and action, spoiler controls,
  participation limits, and impersonation complaint handling.
- Automatically analyze published reviews, analysis, comments, and replies using the extraction
  capability. Authored content remains the authoritative expression of its author; derived claims,
  concepts, and relationships identify the originating contribution and revision.
- Keep publication and reading usable when analysis fails. Expose analysis status and retry without
  requiring the author to republish. Unpublished content is not input to public knowledge
  extraction.
- Reanalyze published edits and invalidate superseded results. Withdrawal or moderation removes
  inaccessible content from ordinary reads and prevents derived results from exposing it. Preserve
  independently supported knowledge without retaining unavailable text or misleading attribution.

Output: Readable native contributions and conversations, plus attributable derived knowledge in the
same collection as external research.

Complete when: One user publishes an analysis, another comments, and the backend exposes concepts or
relationships derived from both with author and revision attribution. Analysis failure leaves the
contributions readable and retryable. Editing replaces outdated derivations; withdrawal or
moderation prevents exposure through content queries and derived results. Another account cannot
edit the author's contribution. Spoiler and moderation decisions apply to every ordinary read.

### 3. Maintain and refine the knowledge collection

Input: Existing works, claims, evidence, concepts, properties, and relationships needing correction.

Requires: Research records and provenance. Native publishing is needed only when maintaining
knowledge derived from native contributions.

Owns authorized inspection, manual creation and correction of works and knowledge records,
source/evidence entry, concept aliases and reconciliation, merge and split previews and execution,
deprecation, change history, and accountable reversal. Expose these operations and their results
through the backend. Retain ambiguous memberships for review and keep original evidence and
expressions available under their retention and visibility rules.

Output: Corrected, queryable knowledge with an inspectable history and compatible references.
Curating derived knowledge must not rewrite authored content. Subsequent research and analysis must
respect recorded corrections rather than silently overwrite them.

Complete when: A curator corrects a relationship, merges duplicate concepts, or splits a combined
meaning, then inspects and reverses the change. Source attribution, original contributions, and
existing references remain intact or explicitly unresolved. A metadata rename preserves work links.
Manual curation remains usable without running research again.

## Subsequent delivery order

Each deliverable includes the operations needed to maintain and consume its output. Application
features include their UI as well as any backend extensions. The prerequisites below identify actual
capabilities, not a requirement to finish every earlier numbered item.

### 4. Semantic search

Requires: Queryable content and visibility rules from research or native publishing.

Deliver semantic query handling, indexing and updates, and inspectable results across external and
native content. Complete when agreed example queries return relevant material with evidence and
context, and edits, withdrawals, and moderation are reflected in results. Search is usable through
the backend before the application exists.

### 5. Related-work recommendations

Requires: Stored genome properties, concepts, and relationships from research.

Deliver recommendation generation, querying, explanations, and refresh after knowledge changes.
Complete when a developer requests related works, inspects the attributes and evidence behind a
suggestion, and sees corrections reflected in its explanation. Semantic search and personal
preferences are not dependencies.

### 6. Research and publishing application

Requires: The research, native publishing, and maintenance backends. Search and recommendation UI
also require their corresponding backend capabilities.

Deliver catalogue, work, genome, concept, evidence, review, analysis, and discussion views. Include
research initiation and status, native authoring and withdrawal, account and moderation controls,
and authorized catalogue/knowledge maintenance. Integrate search and recommendation experiences.
Complete when people can research works, inspect cross-work connections, publish and discuss native
content, and correct knowledge through the application on desktop and mobile. The application uses
the existing backend operations rather than introducing a second write path or data model.

### 7. Precise annotations

Requires: Addressable content, native contribution behavior, and the application.

Deliver passage and data-object selection, annotation authoring, editing, withdrawal, discussion,
and target resolution. Reuse identity, revisions, ownership, moderation, and published-contribution
analysis. Complete when a reader annotates a passage or concept entry and another follows the
annotation to its target. Supported edits preserve the target; missing or ambiguous targets are
explicitly unresolved. This feature extends native publishing rather than introducing it.

### 8. Rich citations

Requires: Addressable knowledge, native contributions, and the application. Annotation citations
require annotations; other citations do not.

Deliver selection, authoring, editing, resolution, and navigation of references to works, concepts,
claims, sources, and contributions. Complete when a review or annotation cites evidence and another
contribution; renames preserve the reference and inaccessible targets are explicitly unavailable.

### 9. Discussion across contexts

Requires: Contributions, work/concept relationships, visibility rules, and the application.
Citation-based placements additionally require rich citations.

Deliver explicit placement rules and bounded related-context views that explain why a contribution
appears and link to its origin. Complete when the same contribution is discoverable through related
works or concepts, edits update every placement, and moderation prevents exposure everywhere.

### 10. Debates and interpretation history

Requires: Claims, evidence, retained revisions, authorized maintenance, and the application.

Deliver debate/question authoring and correction, competing-position comparison, and reader access
to correction history. Complete when a reader compares arguments and counterevidence, follows a
correction to its reason, and inspects earlier wording subject to visibility rules. Revision capture
belongs to the original record's owner and never waits for this feature.

### 11. Scenes and time targets

Requires: Works, the application, annotations, and citations.

Deliver creation and maintenance of scene/time records and permitted media references, scene views,
and annotation and citation of moments. Complete when a curator adds a scene and a reader discusses
or cites a range that another reader can reopen after supported edits, or sees an unresolved state.
Hosted full-length video and automated full-video analysis are not required.

### 12. Semantic timelines

Requires: Scene/time records and their application views.

Deliver timeline queries and browsing of scenes, techniques, and discussion using those maintained
records. Complete when a reader finds a moment on the timeline and opens its scene or discussion;
changes update the timeline and missing coverage is visible.

### 13. Personalized discovery

Requires: Accounts, related-work recommendations, and the application.

Deliver private preference creation, editing, removal, and retrieval together with recommendations
that consume desired and unwanted qualities. Complete when different preferences can change results,
people can inspect and adjust the responsible preference, and another account cannot access it. The
feature spec decides whether inferred behavior is included.

### 14. Automated concept proposals and review

Requires: Preserved observations and validated, reversible knowledge-maintenance operations.

Deliver candidate generation across accumulated observations, evidence inspection, and acceptance,
revision, or rejection through authorized review. Include concepts, aliases, memberships, and typed
relations with examples, counterexamples, and disputed boundaries. Complete when a reviewer traces a
proposal to observations and makes a recorded, reversible change; rejection leaves canonical
knowledge unchanged. This adds collection-wide ontology proposals to the source-backed extraction
already delivered by research and native analysis.

### 15. Contribution activity

Requires: Contributions and the citation, discovery, or correction events being measured.

Deliver activity recording, retention, aggregate queries, and contributor views. Complete when a
contributor inspects activity with its measurement period, without exposing individual readers or
private preferences. Do not invent activity from before recording began.

### 16. Domain reputation

Requires: Inspectable contribution evidence and any measurements consumed by the reputation rules.

Deliver subject-specific assessment, updates, and views of its supporting contributions. Complete
when readers can inspect why a result was assigned and evaluation distinguishes useful evidence and
corrections from popularity or coordinated activity. Include voting-abuse controls if voting is
introduced.

### 17. Additional media target experiences

Requires: The displayed medium, annotations, and citations.

Deliver one complete selection, authoring, editing, resolution, and reading experience per target
type. Complete when a reader annotates or cites an image region, logical chart datum, or another
selected target and reopens it after supported edits. Repeat as separate feature specs. Reviews
already exist through native publishing; votes require their owning feature. Do not build a
universal selector engine as a separate delivery prerequisite.

## From deliverables to feature plans

Start with "Research a collection of works." Each spec defines inputs, owned reads and writes,
usable outputs, prerequisites, and completion scenarios. Its plan selects technology and breaks
implementation into tasks without turning those tasks into roadmap deliverables. The initial backend
must be operable and inspectable without fixtures standing in for an unfinished write path.

Verify provenance and disagreements, permissions, partial failures and retries, repeated runs,
revision attribution, and invalidation after edits or visibility changes in the owning feature. UI
verification begins with application delivery and includes desktop and mobile. Code changes need
applicable type, lint, build, and behavioral checks; documentation changes need consistency, link,
and formatting checks. Report what actually ran.

## Scope crosswalk and exclusions

Existing IDs remain traceability labels. F36 adds native publishing, which the previous annotation
and reply features did not cover. Backend capabilities own working read and write operations;
deliverable 6 adds their graphical experience.

| Capability IDs                                                                                        | Owning deliverables                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F00 runtime; F01 catalogue; F02 genomes/concepts; F03 sources/claims; F11 import; F12 extraction      | 1 delivers research and queryable results; 3 delivers manual maintenance; 6 delivers the application interface.                                                                             |
| F05 accounts/access; F08 replies; F10 moderation/spoilers; F36 native reviews, analysis, and comments | 2 delivers native publishing and automatic analysis; 6 delivers their application interface. Protected research and maintenance operations enforce authorization from their first delivery. |
| F17 participation safeguards                                                                          | 1 owns source/copyright complaints; 2 owns participation limits and impersonation handling. Later features extend those controls to their own behavior.                                     |
| F21 aliases/merges; F22 splits/deprecation                                                            | 3                                                                                                                                                                                           |
| F15 semantic search; F16 related works                                                                | 4 and 5, respectively                                                                                                                                                                       |
| F06 annotations; F07 citations; F09 related-context discussion                                        | 7, 8, and 9, respectively                                                                                                                                                                   |
| F04 debates; F24 interpretation history                                                               | 10                                                                                                                                                                                          |
| F14 scenes/time targets; F30 timelines                                                                | 11 and 12, respectively                                                                                                                                                                     |
| F28 private preferences; F29 personalization                                                          | 13                                                                                                                                                                                          |
| F19 candidate concepts/relations; F20 review/promotion                                                | 14                                                                                                                                                                                          |
| F25 activity; F26 reputation; F23 additional targets                                                  | 15, 16, and 17, respectively                                                                                                                                                                |

F13 concept pages and F27 traversal remain incorporated into F02. F18 observation preservation
belongs to external research and native contribution entry, with no separate delivery feature.

The full consumer scope remains planned. Corpus sizes are development estimates, not architectural
thresholds or release gates. A small caller-selected collection is sufficient to demonstrate
cross-work research; broad corpus growth does not precede the first usable workflow.

Automated full-video analysis and commercial offerings remain outside committed scope:

- F31 Semantic API: partner access to structured knowledge and permitted provenance. The internal
  application API needed for backend delivery is not this commercial offering.
- F32 Research and trend tools: aggregate cultural patterns with coverage and uncertainty visible.
- F33 Audience intelligence: aggregate patterns without exposing individual profiles.
- F34 Partner recommendation infrastructure: recommendation delivery to external products.
- F35 Ontology licensing: versioned concepts with provenance, permitted uses, and change handling.

Professional critic and scholar tools, collections and exports, referrals, and sponsorship remain
uncommitted. Commercial offerings need separate demand, rights, and privacy decisions.
