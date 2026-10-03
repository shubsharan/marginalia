# Product

[Architecture](architecture.md) · [Roadmap](roadmap.md)

## What this is

A social knowledge graph for film and television. People can explore the ideas inside a work,
discuss a specific part of it, and follow that discussion across related works and concepts. The
long-term ambition is a living semantic map of media.

> Everything meaningful is addressable, and anything addressable can be discussed.

A film such as _Heat_ is more than "crime / drama." Its page could connect professional competence,
protagonist-antagonist mirroring, urban isolation, the diner scene, criticism, and arguments about
each. A person could then follow "protagonist-antagonist mirroring" to _The Dark Knight_ or
_Infernal Affairs_.

## The consumer experience

The knowledge collection grows from external research and native reviews, analysis, and comments.
Research begins with a caller-selected set of films or television works: find relevant material,
extract concepts and relationships across those works, and retain the supporting evidence. Native
publishing adds original contributions and automatically analyzes them into the same collection.
Manual curation remains available to correct and extend the knowledge.

The backend makes this data queryable before application pages are designed. The application then
lets people research works, publish and discuss content, explore genomes and concepts, and inspect
evidence. Precise annotations let readers address particular passages or data objects; citations and
related-context discovery connect those discussions. Search, recommendations, scenes, timelines, and
reviewed concept maintenance extend the experience.

The [roadmap](roadmap.md) defines complete deliverables, their prerequisites, and recommended order.
Features can be built when their behavioral prerequisites exist; business-validation stages do not
block unrelated work. This document describes intended behavior, not a claim that these features are
implemented.

A work page should feel useful before it has many contributors. Its research-derived claims must
identify their sources, and the page must distinguish a factual observation from an interpretation.
The product organizes criticism and discussion; it does not manufacture a generic AI review.

## Cinematic genome

The genome describes what a work contains and how it works. Candidate dimensions include narrative
structure and pacing; character arcs and relationships; plot devices; tone; visual grammar; dialogue
and performance; setting and institutions; themes; and cultural relationships such as genre,
influence, and adaptation. External research, analysis of native contributions, and manual curation
populate the same genome and concept records with distinct attribution.

Properties can be factual or interpretive, boolean, categorical, scalar, relational, or temporal.
For example, a heist can be present, an ending can be ambiguous, one film can influence another, or
dramatic irony can apply to a scene. An interpretive theme needs evidence and room for disagreement;
it must not be presented as an objective measurement.

The same approach spans whole works and movements, episodes and scenes, and precise lines, shots,
edits, sounds, and timestamps as their target experiences are built. Curated scenes and permitted
metadata support these experiences without automated full-video analysis, which is outside committed
scope.

## Native publishing and discussion

People can create, edit, publish, read, and withdraw reviews and analysis associated with works.
Comments can address works or contributions, and replies continue those conversations. Authors can
edit and withdraw their comments and replies. Native publishing does not require an external source
to have been imported for that contribution. Authorship, revisions, ownership, publication status,
moderation, and spoiler controls belong to this experience from its first delivery.

Published reviews, analysis, comments, and replies automatically contribute observations, concepts,
and relationships through analysis. The authored content remains the author's own expression;
derived knowledge points to the originating contribution and revision. Readers can distinguish an
author's words from the system's interpretation of them.

Publication remains usable if analysis fails. Authors can inspect analysis status and retry without
republishing. Published edits trigger fresh analysis and invalidate superseded results. Withdrawal
or moderation removes inaccessible content from ordinary reading and prevents its text or claims
from leaking through derived views. Independently supported knowledge can remain with accurate
attribution. Correcting a derived concept must not rewrite the author's contribution.

## Annotation, reply, and citation

An **annotation** addresses an object or a precise part of one. A **reply** addresses another
person's contribution. Keep that distinction even if the interface presents them together. Targets
include highlighted text, concepts, scenes, and timestamps. Additional target experiences can
address image regions, chart data, sources, reviews, analysis, and other contributions. Reviews and
analysis already exist through native publishing; votes become targets only if their owning feature
exists. Precise annotations extend the contribution system rather than introduce publishing.

Contributions may be observations, interpretations, questions, corrections, comparisons, supporting
evidence, or counterexamples. A reply may agree, disagree, qualify, or ask. These distinctions can
help organize discussion, but the interface need not expose every type or stance at launch.

A citation is a rich reference to an addressable object, including works, concepts, claims, reviews,
analysis, comments, annotations, and sources. With scene targets, an argument about the Overlook
Hotel can also cite the hallway sequence that supports it. Citations should preserve their target
and context as the product evolves.

One annotation can appear in several relevant places without being copied. A note on the diner scene
in _Heat_ might also appear under professionalism and protagonist-antagonist mirroring. The
contribution keeps one identity and one primary target. Deeper conversations should remain navigable
through summaries and on-demand detail rather than unlimited visible nesting. This projection keeps
the original discussion intact while making it discoverable elsewhere.

## Evidence and disagreement

A claim is something people can support, challenge, and cite. A manually seeded claim might say that
the Overlook's impossible architecture reflects psychological instability. Its page should show the
supporting source and clearly mark it as an interpretation. Source ingestion groups independent
statements under a shared claim while preserving each source's provenance.

Contested questions must keep their competing answers. "Is Deckard a replicant?" may have yes, no,
and "the ambiguity matters" interpretations, each with arguments and evidence. Do not average
disagreement into a false consensus. Interpretation history shows how evidence and corrections
change those positions. Voting and confidence indicators remain choices for the relevant feature
specs.

External research and native publishing retain their own provenance while contributing to shared
knowledge. Manual curation can correct or add to it. Original observations, authored expressions,
and claim revisions remain recoverable from entry under retention and visibility rules, before a
history or concept-maintenance interface consumes them. A link or attribution does not by itself
grant quotation or republication rights; the [architecture](architecture.md) covers source handling.

## Concepts and language

Curated concepts and proposals derived from what people and sources actually say share one ontology.
Concepts earn a stable place through usefulness and evidence. Curators can add aliases, merge,
split, or deprecate existing concepts without waiting for automated candidate generation. A film can
belong to several overlapping concepts; the result is a graph, not a single taxonomy tree.

People may write "competence porn," "sad dad sci-fi," or "the A24 look" without learning canonical
vocabulary. The system maps such phrases to concepts, preserves them as aliases, or proposes new
candidate concepts for review. Keep the original expressions and observations so later ontology
changes can reinterpret them. Models may propose structural changes; they should not silently become
the authority over contested meanings.

## Discovery and community knowledge

- Concept pages expose meanings, evidence, linked works, and typed relationships. Readers can follow
  explained connections and find projected discussion on the same pages.
- Semantic search covers external research, native content, and curated knowledge. Attribute
  recommendations explain shared genome properties. Private preferences support personalized
  recommendations, including desired affinities and unwanted qualities.
- Scenes, techniques, and discussion density appear along a work's timeline so readers can jump to a
  specific moment.
- Contribution analytics expose useful aggregate activity without disclosing individual readers.
  Interpretation history retains earlier positions and corrections. Domain-specific reputation
  rewards useful corrections, cited annotations, sound evidence, and subject expertise.

## Commercial opportunities

Aggregated cultural patterns could support a semantic API, research and trend tools, audience
intelligence, recommendation infrastructure, or ontology licensing. These are outside committed
consumer scope. Consumer access should likely remain largely free; individual behavioral profiles
are private. Professional critic and scholar tools, advanced collections or exports, ticketing and
streaming referrals, and sponsorship remain possibilities.

## Product requirements and risks

The product needs stable identities for works, concepts, claims, annotations, and citations; source
provenance for seeded evidence; references that survive edits and UI changes; bounded page detail;
and basic controls for spam, harassment, spoilers, and abusive contributions. The
[roadmap](roadmap.md) is authoritative for feature timing. The [architecture](architecture.md)
records technical constraints and proposals.

The main product risks are overbuilding an ontology before observing real discussion, becoming a
metadata catalogue or a forum with decorative tags, replacing criticism with generic AI prose, and
expanding into full-video analysis without a scope decision. Annotation, citation, evidence, and
cross-context discovery must remain central to the experience.
