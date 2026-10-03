<!--
Sync Impact Report
Version change: 2.0.0 -> 2.0.1
Rationale: organize the roadmap around engineering workflows and spec boundaries instead of a
numbered build queue. This clarifies presentation without changing committed consumer scope.
Modified principle: V, replace queue terminology with development-flow terminology.
Modified section: Product and architecture constraints, clarify roadmap ownership.
Aligned documents: docs/product.md, docs/architecture.md, docs/roadmap.md.
Compatibility impact: existing feature IDs remain traceable; related features may share a spec.
No application or data migration is required. Templates continue to read this file at runtime.
The approved 2.0.0 scope expansion remains in force; business-phase gates remain removed.
Preserved: stable identity, evidence, rights, privacy, moderation, reversible concept changes.
Deferred items and follow-up TODOs: none.
-->

# Marginalia Constitution

## Core Principles

### I. Stable targets and one contribution identity

Works, concepts, claims, annotations, and sources MUST have stable IDs, types, and creation and
update times. An annotation MUST retain one identity and one primary target. Related work and
concept pages MUST project that contribution through relationships rather than store copies.
Annotations address objects or precise parts of objects; replies address contributions. The data
model MUST preserve that distinction even when the interface presents them together.

Citations MUST retain their target and context independently of page layout. Text selectors MUST
retain position and quoted context. Edits MUST either preserve or reattach the intended target, or
expose it as unresolved; they MUST NOT silently move an annotation to unrelated text. Concept
targets MUST use stable concept or property IDs. These rules let a discussion remain useful as its
content and presentation change.

### II. Evidence with room for disagreement

Seeded and source-derived claims MUST identify their supporting sources and locations. The
interface MUST distinguish factual observations from interpretations. Competing interpretations
MUST retain their arguments, evidence, and counterevidence rather than become a single supposed
consensus. Source counts and provenance labels MUST reflect actual supporting records.

Source and contribution entry MUST preserve original observations, provenance, and revision context
under the applicable retention policy. Claims MUST retain revisions from creation. Ingestion MUST
retain extraction and model details where applicable. History and concept maintenance MUST consume
these records rather than attempt to reconstruct evidence that was discarded. Missing
support MUST produce a visible failure or an explicitly unsupported state. Models MAY propose
concept changes; canonical changes MUST require validation, an audit trail, and reversibility.
Humans or community governance MUST settle contested meanings and high-impact ontology changes.
Concept merges, splits, and deprecations MUST preserve existing references. Marginalia organizes
criticism and discussion; generated prose cannot substitute for evidence.

### III. Source rights and individual privacy

Curated evidence MUST retain source identity, location, and permitted use. Collection and display
decisions MUST distinguish permission to index or analyze from permission to quote or republish.
Attribution and outbound links MUST NOT be treated as reuse permission. External source text,
when processed, MUST remain separate from the user-facing graph and follow source-specific
retention rules. Broad ingestion MUST include source-rights assessment and legal review before
rollout.

Individual behavioral profiles MUST remain private. Any later cultural-intelligence offering
MUST use aggregate cultural patterns and evaluate demand and rights before committing to an
offering. The graph's value comes from structured evidence and discussion, not copied source prose
or disclosure of individual behavior.

### IV. Navigable discussion with abuse controls

Work pages MUST offer useful, sourced content before they have many contributors. The interface
MUST keep an annotation's original target and citations discoverable wherever the annotation
appears. Initial page queries and visible discussion MUST be bounded, with deeper detail loaded
on demand. A general target model MUST NOT require unlimited visible nesting or loading the whole
graph.

The first release MUST include usable controls for spam, harassment, spoilers, and abusive
contributions. Broader participation and automated graph changes MUST introduce the corresponding
rate limits, voting-abuse controls, source and copyright complaint handling, impersonation
controls, and ontology review. When ranking or reputation is introduced, its evaluation MUST check
that popularity and coordinated activity do not substitute for evidence or subject expertise.

### V. Build by user outcome and behavioral dependency

Every feature MUST identify its user outcome, roadmap feature ID, and hard behavioral prerequisites.
The full consumer product is in scope, including ingestion, discussion, discovery, media targets,
and concept maintenance. Manual curation MUST remain supported alongside ingestion.

Implementation MUST satisfy the prerequisites required by the behavior being delivered. Independent
features MAY proceed without completing an entire epic or validating a business hypothesis. Specs
MAY be drafted together when they share behavior. Feature IDs identify capabilities; the roadmap describes the development flow and
cohesive spec boundaries. Integration and release checks MUST remain distinct from build dependencies.

New infrastructure, abstractions, and schema entities MUST serve an identified feature requirement.
Business research informs iteration without blocking unrelated work. Corpus sizes MUST remain
seed-data estimates, and research signals MUST remain hypotheses until verified. Automated
full-video analysis and commercial offerings remain outside committed consumer scope and require
an explicit scope decision before implementation.

## Product and architecture constraints

- `docs/product.md` defines the product experience. Annotation, citation, evidence, and discovery
  across related contexts MUST remain central to feature decisions.
- `docs/roadmap.md` owns feature scope, engineering epics, and the development flow. Scope and dependency
  changes MUST identify the affected feature and rationale. Business-phase validation MUST NOT
  become a prerequisite for independent consumer features.
- `docs/architecture.md` records constraints and proposals. Candidate databases, frameworks,
  storage services, and job systems MUST NOT be treated as adopted choices without a documented
  decision tied to current needs. The starter README does not establish product architecture.
- Structured fields needed for queries MUST remain queryable rather than placing the entire graph
  in opaque JSON. A dedicated graph database is not required. Concept relationships MUST support
  overlapping, typed connections rather than enforce a single taxonomy tree.
- Selectors MUST be added with their associated user experience and define supported edit and
  unresolved-target behavior. A general target model alone does not justify an unused selector.

## Development workflow and verification

Specifications and plans MUST identify the user journey, roadmap feature and epic, hard behavioral
prerequisites, applicable principles, acceptance criteria, and any proposed exception before implementation. Reviews MUST check those
commitments against the resulting behavior. Keep changes within the requested scope and preserve
unrelated work.

Verification MUST match the behavior changed. Changes to identity, targeting, citations, or
projection MUST demonstrate that references survive supported edits, unresolved targets remain
visible, and related views retain one contribution identity. Evidence changes MUST verify source
links and the distinction between fact and interpretation. Discussion changes MUST verify bounded
loading and applicable abuse controls. User-facing changes MUST be checked on desktop and mobile.

Code changes MUST pass applicable type, lint, build, and focused behavioral checks. Documentation
changes require consistency and formatting checks rather than an application build. Reports MUST
state what ran, what passed or failed, and what was not run; intended behavior and roadmap
hypotheses MUST NOT be reported as implemented or verified capabilities. Verification failures
MUST be surfaced rather than hidden behind success-shaped fallback behavior.

## Governance

This constitution governs project specifications, plans, implementation, and review. Supporting
documents MUST remain consistent with it. Its initial adoption derives from `docs/product.md`,
`docs/architecture.md`, and `docs/roadmap.md`; this document establishes rules, not proof that the
product already implements them.

Amendments MUST identify the affected rules, rationale, compatibility impact, and any migration or
document follow-up. The project owner or designated maintainer MUST approve substantive rule
changes before work relies on them. An exception MUST name its scope, rationale, approver, and
expiry or review condition; a lasting exception requires an amendment.

Versions follow semantic versioning. Increment MAJOR for incompatible removals or redefinitions,
MINOR for new principles or materially expanded guidance, and PATCH for non-semantic corrections
or clarifications. Each amendment MUST update the Sync Impact Report and last-amended date while
preserving the original ratification date. Plans and pull-request reviews MUST record compliance
or explicitly identify an approved exception. Dependent Spec Kit templates read this constitution
at runtime and MUST NOT be edited merely to duplicate its rules.

**Version**: 2.0.1 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
