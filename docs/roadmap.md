# Development roadmap

[Product](product.md) · [Architecture](architecture.md)

## Goal

Build a social knowledge graph for film and television: evidence-backed claims, concepts, genome
properties, and typed relationships across works, grown from external research and native
publishing, and open to annotation, discussion, and discovery. The backend comes first — searching
for data, extracting claims and relationships, and persisting queryable knowledge — fully operable
through commands or APIs before any application pages exist. The application is then designed around
that real data.

## Delivery

- Features ship in the order below. Only stated prerequisites are dependencies; independent work
  need not wait.
- Each feature owns a complete workflow: its writes, reads, and failure behavior. Backend features
  are usable without application pages; their graphical interface arrives with the application.
- The repository currently contains workspace tooling, shared TypeScript configuration, and Spec Kit
  setup. Nothing below is implemented. Stack, providers, schemas, and extraction methods are chosen
  in feature plans. The [search spec](specs/001-search/spec.md) covers backend feature 1.

## Backend features

### 1. Search

Resolve a caller-selected set of film or television titles and discover relevant external sources
for researching them together. Ambiguous matches are exposed for caller resolution, and automatic
expansion to other works is out of scope. Includes the minimal runtime, persistence, migrations,
configuration, and local startup this workflow needs.

Requires nothing. Done when a developer, from a fresh checkout, submits several titles and inspects
the resolved works and discovered sources, with ambiguity left explicit.

### 2. Rights-aware ingestion

Retrieve permitted material from discovered sources while retaining source identity and location and
distinguishing permission to process from permission to display. Owns retention rules,
source/copyright complaint handling, and visible, retryable source failures. Broad ingestion waits
on the source-rights assessment and legal review.

Requires feature 1. Done when retrieved material is inspectable with its provenance and a failed
source is visible and retryable.

### 3. Claim and relationship extraction

Extract observations, claims, concepts, genome properties, and typed relationships within and across
the selected works. Preserve source passages or permitted references, extraction provenance,
revisions, and conflicting interpretations; expose unsupported results rather than treating them as
established knowledge. Extraction does not silently settle contested meanings or merge canonical
concepts — those changes belong to knowledge maintenance.

Requires feature 2 for external material; native publishing later reuses the same capability. Done
when concepts shared across works are queryable and a relationship is traceable to its supporting
source material, with disagreement kept explicit.

### 4. Knowledge store and query APIs

Persist works and extraction results with stable identities, and provide research submission,
status, retry, and queries for works, sources, evidence, concepts, properties, and relationships.
Repeated runs accumulate knowledge without duplicating records or erasing disagreement. Includes the
deployable backend for the full research workflow.

Requires features 1–3. Done when a developer researches several works from a fresh checkout, queries
concepts they share, and traces a relationship to source material without a UI, and rerunning does
not duplicate published results.

### 5. Native publishing and discussion

Create, edit, publish, read, and withdraw reviews and analysis; comment on works and contributions,
with replies and bounded conversation retrieval. Owns sign-in, author identity, ownership checks,
revision history, publication status, moderation, spoiler controls, participation limits, and
impersonation handling. Published content is automatically analyzed through the extraction
capability, with author and revision attribution; publication stays usable when analysis fails,
edits trigger reanalysis, and withdrawal or moderation removes content from ordinary reads and
derived results.

Requires work identities, persistence, and extraction from features 1–4. Done when one user
publishes an analysis, another comments, and the backend exposes attributed derived knowledge from
both; another account cannot edit the author's contribution.

### 6. Knowledge maintenance

Authorized inspection and manual correction of works and knowledge records: source/evidence entry,
concept aliases and reconciliation, merge and split previews and execution, deprecation, change
history, and accountable reversal. Curation never rewrites authored content, and subsequent research
respects recorded corrections.

Requires research records and provenance from features 1–4. Done when a curator corrects a
relationship, merges or splits concepts, then inspects and reverses the change with references
intact or explicitly unresolved.

### 7. Semantic search

Semantic query handling, indexing, and inspectable results across external and native content,
respecting visibility rules. Requires queryable content from features 4 or 5. Done when example
queries return relevant material with evidence, and edits, withdrawals, and moderation are reflected
in results — all through the backend.

### 8. Related-work recommendations

Recommendation generation, querying, explanations, and refresh after knowledge changes. Requires
stored genome properties, concepts, and relationships from feature 4. Done when a developer requests
related works, inspects the evidence behind a suggestion, and sees corrections reflected in its
explanation.

## Application features

Each includes its UI and any backend extensions it needs. The application consumes the existing
backend operations; it does not introduce a second write path or data model.

### 9. Research and publishing application

Catalogue, work, genome, concept, evidence, review, analysis, and discussion views; research
initiation and status; native authoring; account, moderation, and maintenance controls; integrated
search and recommendations. Requires the backend features above. Done when people can research
works, inspect cross-work connections, publish and discuss content, and correct knowledge through
the application on desktop and mobile.

### 10. Precise annotations

Passage and data-object selection, annotation authoring and discussion, and target resolution,
reusing the native contribution lifecycle. Requires features 5 and 9. Supported edits preserve the
target; missing targets are explicitly unresolved.

### 11. Rich citations

Authoring, resolution, and navigation of references to works, concepts, claims, sources, and
contributions. Requires addressable knowledge and feature 9; annotation citations require
feature 10. Renames preserve references; inaccessible targets are explicitly unavailable.

### 12. Discussion across contexts

Explicit placement rules and bounded related-context views that explain why a contribution appears
elsewhere and link to its origin. Requires features 5 and 9; citation-based placement requires
feature 11.

### 13. Debates and interpretation history

Debate and question authoring, competing-position comparison, and reader access to correction
history. Requires claims, retained revisions, maintenance, and feature 9.

### 14. Scenes, time targets, and timelines

Scene/time records with permitted media references, scene views, annotation and citation of moments,
and timeline browsing of scenes, techniques, and discussion. Requires features 9, 10, and 11. Hosted
full-length video is not required.

### 15. Personalized discovery

Private preference management feeding recommendations that honor desired and unwanted qualities.
Requires accounts, feature 8, and feature 9. Preferences are inspectable by their owner and
inaccessible to other accounts.

### 16. Automated concept proposals and review

Collection-wide candidate concepts, aliases, memberships, and typed relations generated from
accumulated observations, with evidence inspection and authorized, reversible review. Requires
preserved observations and feature 6. Rejection leaves canonical knowledge unchanged.

### 17. Contribution activity and domain reputation

Activity recording and aggregate contributor views without exposing individual readers, plus
subject-specific reputation grounded in inspectable evidence rather than popularity. Requires the
contributions and events being measured.

### 18. Additional media target experiences

One complete selection, authoring, resolution, and reading experience per further target type (image
regions, chart data, and others), each as its own feature spec. Requires the displayed medium and
features 10 and 11.

## Out of scope

Automated full-video analysis and commercial offerings — a semantic API, research and trend tools,
audience intelligence, partner recommendation infrastructure, and ontology licensing — remain
outside committed scope, as do professional critic tools, collections and exports, referrals, and
sponsorship. Legacy feature IDs (F00–F36) from earlier documents remain traceability labels only.
