# Architecture

[Product](product.md) · [Roadmap](roadmap.md)

This document records constraints and possible approaches for the full consumer product. The
[roadmap](roadmap.md) defines complete deliverables, their prerequisites, and recommended order.
Stack choices remain proposals until adopted in a feature plan; the descriptions here are not
implementation claims.

## Backend and application boundaries

External research and native publishing are two inputs to one persisted, queryable knowledge
collection. The backend owns their complete write and read workflows before the graphical
application exists. Start with a caller-selected collection of works, source search, extraction, and
evidence-backed relationships across the collection. Commands or APIs must make the workflow
operable and its results inspectable. The first research workflow does not expand its own work set.

Native publishing owns original reviews, analysis, comments, and replies. Extraction derives
knowledge from external material or published native contributions while retaining their distinct
provenance. Knowledge maintenance owns corrections to those derived records, not edits to an
author's words. The later application exposes these operations and builds views around the actual
data; it does not introduce another data model or write path. These are ownership boundaries, not a
requirement for separate services or packages.

## Shared foundations

Use a small set of shared concepts so work pages, discussions, and citations do not need separate
identity rules:

- **Object:** A work, concept, claim, source, contribution, or other addressable item.
- **Contribution:** Native authored content such as a review, analysis, comment, reply, or
  annotation. Its authorship, revisions, and visibility remain distinct from knowledge derived
  through analysis.
- **Selector:** A precise part of an object, such as a text range or concept property.
- **Annotation:** A contribution with one primary target, which may be an object or selector.
- **Reference:** A citation from one object to another.
- **Relation:** A typed semantic connection between objects.
- **Projection:** A place where an existing annotation can be found without making another copy.

Give addressable objects stable IDs, types, and creation and update times. Store the primary target
of each annotation and the references it makes. Build related views from those relationships; do not
duplicate contributions when projecting them to concept or work pages. A manually seeded claim needs
a source reference and a visible distinction between fact and interpretation.

A text selector should retain its position and quoted context so an annotation can be reattached
after an edit or flagged when its target can no longer be found. A concept target needs a stable
concept or property ID, not a screen position. References should resolve independently of the
current page layout.

Additional selectors address video time ranges, image regions, chart series and datum IDs, genome
relations, and annotations themselves. Chart targets should use logical data IDs rather than pixels.
Add each selector only when its corresponding user experience is built.

## Provenance, rights, and moderation

Keep source identity, location, and permitted use with manually curated evidence. The system should
distinguish indexing and derived analysis from quotation and republication. Attribution and an
outbound link do not grant reuse rights. When external text is processed, keep it separate from the
user-facing graph and apply source-specific retention rules. Source-derived claims should retain the
supporting location, extraction provenance, and model version where applicable.

Native publishing needs usable controls for spam, harassment, spoilers, and abusive contributions
from its first delivery, including backend enforcement before the application UI exists. It owns
participation limits and impersonation handling; external research owns source and copyright
complaints. Add voting-abuse controls with voting and ontology review with automated change
proposals. The interface should show a bounded set of contributions first and load deeper discussion
on demand; a general target model does not require an infinitely nested interface.

## Data and stack choices

A relational store can represent objects, annotations, references, and typed relations. Postgres is
a candidate, not a decision. Keep structured fields queryable rather than placing the whole graph in
opaque JSON. Schemas follow the features being implemented. Preserve source observations, original
contribution expressions, and claim revisions from entry so history and concept maintenance do not
require reconstructing lost evidence. Add other entities when their owning behavior is built.

The application could use a web client and API, Postgres full-text search or vector retrieval,
object storage for permitted artifacts, and background jobs for ingestion and derived views. React
or Next.js, Hono, Node or Bun, pgvector, and S3 or R2 are examples to evaluate when needed. A
dedicated graph database is not assumed. Use bounded page queries rather than hydrating the whole
graph.

## External research

Research resolves a caller-selected set of titles, discovers relevant sources, retrieves permitted
material, and turns it into observations and claims. It identifies concepts and connects works and
arguments while retaining provenance and outbound links. Ambiguous work matches require explicit
resolution, and partial source or extraction failures remain inspectable and retryable. Repeated
runs reuse identities and accumulate results without duplicate publication. The graph's durable
value is the derived structure and the conversation around it, not a mirror of third-party prose.
Candidate sources include open datasets, licensed metadata, criticism, interviews, academic work,
blogs, and permitted APIs. Rights, retention, and quotation policy must be checked for each source
before scaling this pipeline.

External extraction, native analysis, and manual curation use the same knowledge write operations
and queryable records. Source references support genomes before rich contributor-authored citations
exist. Research does not require a debate interface or manually authored work pages.

Independent source statements may support one claim, but keep each statement's provenance. Preserve
disagreement and counterevidence rather than silently producing one canonical interpretation. A
source-aware pipeline must fail visibly when a claim lacks supporting material.

## Native publication and derived knowledge

Publishing owns creation, editing, publication, reading, and withdrawal of reviews and analysis,
comments on works or contributions, and replies. It includes account access, ownership checks,
revision history, publication state, conversation retrieval, reporting, moderation, and spoiler
controls. Comments and replies also support author editing and withdrawal. Precise annotations later
reuse this contribution behavior and add target selection.

Automatically analyze published reviews, analysis, comments, and replies. Keep publication state
separate from analysis status: extraction failure must not turn a successful publication into a
failed or unreadable contribution. Expose analysis failures and retries without requiring another
publication. Unpublished content must not become publicly queryable extracted knowledge.

Derived observations, claims, concepts, and relationships retain contribution identity, author,
revision, supporting location, and extraction provenance. Authored content is authoritative for what
its author said; extracted interpretations remain separate. Editing a concept or relationship must
not rewrite the contribution. Native analysis reuses extraction behavior without pretending a native
contribution is an external import.

A published edit triggers reanalysis and invalidates superseded results. Retrying the same analysis
must not duplicate derivations. An analysis of an older revision must not restore stale results
after an edit, withdrawal, or moderation action. Current visibility applies to direct content reads,
evidence queries, and derived results even while analysis or index updates are pending.

Withdrawal or moderation removes inaccessible material from ordinary reads and prevents it from
being exposed through evidence, snippets, search, recommendations, or related-context views. Keep
independently supported knowledge with its remaining attribution; do not erase other sources or
retain a hidden contribution as publicly inspectable support. Historical revisions remain subject to
the same retention and visibility rules. The feature plan chooses execution and invalidation
mechanisms that enforce these behaviors.

## Concept formation and maintenance

Retain the observation layer: what people, critics, and sources actually said. Research and native
analysis already extract source-backed concepts, memberships, and relationships. They must preserve
uncertainty rather than silently merge canonical meanings. Later collection-wide candidate formation
follows observation, cluster, candidate concept, and reviewed promotion. Curated concepts can
independently receive aliases, merges, splits, and deprecation changes. Historical observations stay
available for later reinterpretation.

Maintenance exposes inspection, manual creation and correction, reference handling, change history,
and reversal through the backend. Later research or analysis must respect recorded corrections
rather than silently overwrite them. Its graphical controls are part of the application delivery.

Possible promotion evidence includes use across distinct works and contributors, persistence,
semantic cohesion, low redundancy, and improvement to explanation or discovery. Concept membership
can be fuzzy rather than absolute. For a concept such as "slow burn," retain positive examples,
counterexamples, and disputed boundary cases.

Represent concepts with typed, many-to-many relations rather than one parent ID. For example, body
horror may be a subtype of horror, frequently use bodily transformation, and be associated with
identity instability. Candidate relations may come from source language, co-occurrence, asymmetrical
conditional probabilities, temporal order, graph context, or human correction. Co-occurrence alone
does not prove hierarchy.

The ontology supports merge, split, alias, and deprecation paths. Redundant concepts can merge;
stable subclusters may split; equivalent phrases can become aliases; unused or misleading terms can
be deprecated. Prefer concepts that improve retrieval, recommendation, or explanation enough to
justify their complexity. This is the practical value behind information-gain and
minimum-description-length ideas, not a request to build those metrics now.

Statistical methods and embeddings may find clusters or anomalies. A bounded classifier may suggest
aliases or membership. A larger model may name or explain candidate changes. Humans or community
governance should settle culturally meaningful distinctions, sensitive disputes, and high-impact
changes. Models propose patches; canonical changes require validation, an audit trail, and a way to
reverse them. Versioned ontology changes must preserve existing references.

## Discovery and derived systems

Concept pages and typed traversal read the shared research, native-derived, and curated records.
Projection adds discussion to those same pages without copying contributions. Semantic search
indexes external and native content as well as curated knowledge, with consistent visibility.
Attribute recommendations consume genomes; personalized recommendations add private preferences
without depending on a concept-path browsing interface. Timelines consume scene and time targets
without requiring cross-context projection.

As search, recommendations, reputation, and concept maintenance are built, changes to annotations,
citations, claims, sources, votes, and concepts may trigger background updates to indexes, counts,
summaries, ranking, and candidate queues. Choose event and job machinery when these derived views
become necessary. Ordinary page reads need no event catalogue. Analytics records activity from its
measurement start; it does not require the interpretation-history interface or invent earlier
activity.

Ranking should not let popularity overwhelm evidence or subject expertise. Source quality, citation
use, contextual reputation, and diversity may help, but require evaluation against actual use.

## Technical risks

- **Unstable targets:** Edits can detach annotations. Retain stable IDs and text context, and
  surface unresolved targets rather than silently moving them.
- **Ontology entropy:** Unchecked concepts can proliferate. Use aliases, promotion evidence,
  reversible changes, and human review for canonical concept changes.
- **Source rights:** Processing permission differs from quotation or republication permission.
  Preserve rights metadata and seek legal review before broad ingestion.
- **Recursive discussion:** Summarize and load depth on demand while retaining precise targets and
  citations.
- **Graph abuse and ranking:** Moderate content and graph changes; evaluate reputation and ranking
  so coordinated activity or popularity does not stand in for evidence.
