# Architecture

[Product](product.md) · [Roadmap](roadmap.md)

This document records constraints and possible approaches for the full consumer product. The
[roadmap](roadmap.md) defines engineering epics, feature boundaries, and the development flow. Stack
choices remain proposals until adopted in a feature plan; the descriptions here are not
implementation claims.

## Shared foundations

Use a small set of shared concepts so work pages, discussions, and citations do not need separate
identity rules:

- **Object:** A work, concept, claim, annotation, source, or other addressable item.
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

The first release needs a way to handle spam, harassment, spoilers, and abusive annotations. Broader
participation and automated graph changes will also need rate limits, voting abuse controls, source
and copyright complaints, impersonation controls, and review of ontology changes. The interface
should show a bounded set of contributions first and load deeper discussion on demand; a general
target model does not require an infinitely nested interface.

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

## Source ingestion

Automated ingestion turns permitted source material into observations and claims, identifies works
and concepts, connects related arguments, and retains provenance and outbound links. The graph's
durable value is the derived structure and the conversation around it, not a mirror of third-party
prose. Candidate sources include open datasets, licensed metadata, criticism, interviews, academic
work, blogs, and permitted APIs. Rights, retention, and quotation policy must be checked for each
source before scaling this pipeline.

Manual curation and ingestion use the same source and claim records. Source references support
genomes before contributor-authored citations exist. Ingestion does not require a debate interface.

Independent source statements may support one claim, but keep each statement's provenance. Preserve
disagreement and counterevidence rather than silently producing one canonical interpretation. A
source-aware pipeline must fail visibly when a claim lacks supporting material.

## Concept formation and maintenance

Retain the observation layer: what people, critics, and sources actually said. Candidate formation
follows observation, cluster, candidate concept, and reviewed promotion. Curated concepts can
independently receive aliases, merges, splits, and deprecation changes. Historical observations stay
available for later reinterpretation.

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

Concept pages and typed traversal operate on curated records. Projection adds discussion to those
same pages without copying contributions or requiring replies. Semantic search indexes curated
content as well as ingested content. Attribute recommendations consume genomes; personalized
recommendations add private preferences without depending on a concept-path browsing interface.
Timelines consume scene and time targets without requiring cross-context projection.

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
