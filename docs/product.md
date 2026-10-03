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

The product combines manually curated and source-seeded work pages, genomes, concept pages,
evidence-backed debate, annotations, citations, and related-context discovery. A visitor can
highlight a phrase or annotate a concept, cite an existing object, and find that contribution both
at its original target and through a related concept. Search, recommendations, scenes, timelines,
and reviewed concept maintenance extend this same experience.

The [roadmap](roadmap.md) defines the development flow, feature boundaries, and seed-data estimates.
Features can be built when their behavioral prerequisites exist; business-validation stages do not
block unrelated work. This document describes intended behavior, not a claim that these features are
implemented.

A work page should feel useful before it has many contributors. Its seeded claims must identify
their sources, and the page must distinguish a factual observation from an interpretation. The
product organizes criticism and discussion; it does not manufacture a generic AI review.

## Cinematic genome

The genome describes what a work contains and how it works. Candidate dimensions include narrative
structure and pacing; character arcs and relationships; plot devices; tone; visual grammar; dialogue
and performance; setting and institutions; themes; and cultural relationships such as genre,
influence, and adaptation. Manual curation and source-derived observations populate the same genome
and concept records.

Properties can be factual or interpretive, boolean, categorical, scalar, relational, or temporal.
For example, a heist can be present, an ending can be ambiguous, one film can influence another, or
dramatic irony can apply to a scene. An interpretive theme needs evidence and room for disagreement;
it must not be presented as an objective measurement.

The same approach spans whole works and movements, episodes and scenes, and precise lines, shots,
edits, sounds, and timestamps as their target experiences are built. Curated scenes and permitted
metadata support these experiences without automated full-video analysis, which is outside committed
scope.

## Annotation, reply, and citation

An **annotation** addresses an object or a precise part of one. A **reply** addresses another
person's contribution. Keep that distinction even if the interface presents them together. Targets
include highlighted text, concepts, scenes, and timestamps. Additional target experiences can
address image regions, chart data, sources, and other annotations. Votes and reviews become targets
only if their owning features exist.

Contributions may be observations, interpretations, questions, corrections, comparisons, supporting
evidence, or counterexamples. A reply may agree, disagree, qualify, or ask. These distinctions can
help organize discussion, but the interface need not expose every type or stance at launch.

A citation is a rich reference to an addressable object, including works, concepts, claims,
annotations, and sources. With scene targets, an argument about the Overlook Hotel can also cite the
hallway sequence that supports it. Citations should preserve their target and context as the product
evolves.

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

Manual curation and automated ingestion both use permitted source material to seed pages. Original
observations, provenance, and claim revisions remain recoverable from entry, before a history or
concept-maintenance interface consumes them. A link or attribution does not by itself grant
quotation or republication rights; the [architecture](architecture.md) covers source handling.

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
- Semantic search works with curated content and expands with ingestion. Attribute recommendations
  explain shared genome properties. Private preferences support personalized recommendations,
  including desired affinities and unwanted qualities.
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
