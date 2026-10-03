<!--
Sync Impact Report
Version change: 2.0.2 -> 3.0.0
Rationale: limit constitutional authority to durable project principles and governance.
Modified principles:
- I. Stable targets and one contribution identity -> I. Preserve meaning and context
- II. Evidence with room for disagreement -> II. Evidence with room for disagreement
- III. Source rights and individual privacy -> III. Respect rights and privacy
- IV. Navigable discussion with abuse controls -> IV. Safe and accountable participation
- V. Build by user outcome and behavioral dependency -> V. Build for an identified user need
Replaced sections: Product and architecture constraints -> Document ownership;
Development workflow and verification -> Verification and review.
Added: an explicit boundary against feature and implementation detail in the constitution.
Removed from constitutional authority: field layouts, selector mechanics, storage choices,
feature inventories, delivery sequencing, release checklists, and feature-specific test rules.
Compatibility: these requirements remain in docs/product.md, docs/architecture.md, and
docs/roadmap.md. No product scope or implementation changes; templates remain unchanged.
Approval: project owner requested this revision in the current conversation.
Follow-up TODOs: none.
-->

# Marginalia Constitution

## Core Principles

### I. Preserve meaning and context

References and discussions MUST preserve what they address as content changes. A contribution
encountered in another context MUST remain identifiable as the same contribution, with its origin
accessible. When the intended reference cannot be preserved, the product MUST make that loss
explicit rather than silently substitute a different meaning.

### II. Evidence with room for disagreement

Claims MUST be traceable to their evidence, with missing support and uncertainty made explicit. The
product MUST distinguish observations from interpretations and preserve competing arguments rather
than manufacture consensus. Corrections MUST remain accountable to the evidence and prior meaning
they change. Generated content, popularity, and activity MUST NOT substitute for evidence. Models
MAY propose changes; contested meanings and high-impact knowledge changes MUST remain subject to
accountable human judgment and correction.

### III. Respect rights and privacy

Collection, analysis, display, and reuse MUST respect the permissions applicable to each use.
Attribution alone MUST NOT be treated as permission. Individual behavioral profiles MUST remain
private, and aggregate reporting MUST NOT expose individual behavior. Retention and disclosure
choices MUST honor these commitments throughout the product.

### IV. Safe and accountable participation

Participation MUST include usable ways to report abuse and apply moderation decisions consistently.
Readers MUST retain control over spoiler exposure. Knowledge and moderation decisions MUST have
clear responsibility and a way to correct mistakes. Features that distribute or rank contributions
MUST preserve these protections wherever the contributions appear.

### V. Build for an identified user need

Features and technical complexity MUST serve an identified user outcome. Design decisions MUST be
justified by current requirements rather than speculative future use. Implementation and delivery
choices MAY evolve within these principles; changing them alone does not amend the constitution.

## Document ownership

This constitution owns durable project principles and governance. A proposed rule belongs here only
if it expresses a deliberate project-wide commitment that should survive changes in feature scope,
development sequence, and implementation. Being important or using MUST does not make a feature
requirement constitutional.

- [Product](../../docs/product.md) owns the intended experience and product requirements.
- [Architecture](../../docs/architecture.md) owns technical constraints, shared design decisions,
  and implementation proposals. It MUST distinguish proposals from adopted decisions.
- [Roadmap](../../docs/roadmap.md) owns committed scope, exclusions, delivery order, and
  dependencies.
- Feature specs own behavior and acceptance criteria. Feature plans and tasks own implementation
  mechanisms and concrete verification work.

Fields, schemas, algorithms, feature IDs, milestones, and test checklists MUST stay in their owning
documents. Changes to those details MUST NOT require constitutional amendments unless they change a
project principle. Removing duplicated detail from this constitution does not cancel the
requirements in its owning document.

## Verification and review

Claims about implementation, correctness, or readiness MUST be supported by relevant verification.
Reports MUST distinguish intended behavior from implemented behavior and state what was checked,
what failed, and what remains unverified. Failures MUST NOT be disguised as successful results.

Plans and reviews MUST assess applicable constitutional principles and the requirements in the
owning documents. They MUST define verification appropriate to the change; this constitution does
not prescribe individual test cases, tools, or commands.

## Governance

Supporting documents and implementation MUST comply with these principles. Amendments MUST identify
the principle being changed, the reason, compatibility impact, and any required follow-up. The
project owner or designated maintainer MUST approve substantive amendments before work relies on
them. Exceptions MUST record their scope, rationale, approver, and expiry or review condition.
Lasting exceptions require an amendment.

Version changes follow semantic versioning: MAJOR for incompatible principle or governance changes,
MINOR for new or materially expanded principles, and PATCH for non-semantic clarifications.
Amendments MUST update the Sync Impact Report and last-amended date while preserving the original
ratification date. Dependent templates read this document at runtime and MUST NOT duplicate its
rules.

**Version**: 3.0.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
