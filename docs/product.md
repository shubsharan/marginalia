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

## The first experience

The prototype opens on a small set of manually curated work pages. Each has a work-level genome and
links to related concepts. One debate shows distinct interpretations and the sources behind them. A
visitor can highlight a phrase or annotate a concept, cite an existing object, and find that
contribution both at its original target and in a related context. They can browse between works and
concepts without a feed or a search engine. The [roadmap](roadmap.md) owns the corpus size and
success signals.

A work page should feel useful before it has many contributors. Its seeded claims must identify
their sources, and the page must distinguish a factual observation from an interpretation. The
product organizes criticism and discussion; it does not manufacture a generic AI review.

## Cinematic genome

The genome describes what a work contains and how it works. Candidate dimensions include narrative
structure and pacing; character arcs and relationships; plot devices; tone; visual grammar; dialogue
and performance; setting and institutions; themes; and cultural relationships such as genre,
influence, and adaptation. A small manually chosen concept set is enough for the prototype.

Properties can be factual or interpretive, boolean, categorical, scalar, relational, or temporal.
For example, a heist can be present, an ending can be ambiguous, one film can influence another, or
dramatic irony can apply to a scene. An interpretive theme needs evidence and room for disagreement;
it must not be presented as an objective measurement.

The same approach can later span whole works and movements, episodes and scenes, and precise lines,
shots, edits, sounds, and timestamps. Those finer resolutions are future capabilities, not a
requirement to analyze complete video in the prototype.

## Annotation, reply, and citation

An **annotation** addresses an object or a precise part of one. A **reply** addresses another
person's contribution. Keep that distinction even if the first interface is simple. The prototype
supports highlighted text and concepts; later targets could include scenes, timestamps, image
regions, chart data, votes, reviews, sources, and other annotations.

Contributions may be observations, interpretations, questions, corrections, comparisons, supporting
evidence, or counterexamples. A reply may agree, disagree, qualify, or ask. These distinctions can
help organize discussion, but the interface need not expose every type or stance at launch.

A citation is a rich reference to an addressable object. The prototype can cite works, concepts,
claims, annotations, and sources. A later argument about the Overlook Hotel could also cite the
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
supporting source and clearly mark it as an interpretation. Later source ingestion may group
independent statements under a shared claim while preserving each source's provenance.

Contested questions must keep their competing answers. "Is Deckard a replicant?" may have yes, no,
and "the ambiguity matters" interpretations, each with arguments and evidence. Do not average
disagreement into a false consensus. Voting, confidence, and the history of support are possible
later additions.

The prototype can use permitted source material to seed pages manually. Automated collection and
synthesis come later. A link or attribution does not by itself grant quotation or republication
rights; the [architecture](architecture.md) covers source handling.

## Concepts and language

The initial concept set is curated. The longer-term ontology should emerge from what people and
sources actually say, with concepts earning a stable place through usefulness and evidence. A film
can belong to several overlapping concepts; the result is a graph, not a single taxonomy tree.

People may write "competence porn," "sad dad sci-fi," or "the A24 look" without learning canonical
vocabulary. Later the system may map such phrases to concepts, preserve them as aliases, or let new
candidate concepts form. Keep the original expressions and observations so later ontology changes
can reinterpret them. Models may propose structural changes; they should not silently become the
authority over contested meanings.

## Future product directions

- Semantic search and concept pages arrive with a larger seeded network. Later, explainable
  recommendations can combine affinities such as institutional politics and procedural realism while
  excluding unwanted qualities such as lore-heavy exposition.
- Scenes, techniques, and discussion density can appear along a work's timeline so someone can jump
  to a specific moment.
- Reputation can reward useful corrections, cited annotations, sound evidence, and subject expertise
  rather than follower counts alone.
- Aggregated cultural patterns could support a semantic API, research and trend tools, audience
  intelligence, recommendation infrastructure, or ontology licensing. Consumer access should likely
  remain largely free; individual behavioral profiles are private. Professional critic and scholar
  tools, advanced collections or exports, ticketing and streaming referrals, and sponsorship are
  possibilities, not initial commitments.

## Product requirements and risks

The prototype needs stable identities for works, concepts, claims, annotations, and citations;
source provenance for seeded evidence; references that survive edits and UI changes; bounded page
detail; and basic controls for spam, harassment, spoilers, and abusive contributions. The
[roadmap](roadmap.md) is authoritative for feature timing. The [architecture](architecture.md)
records technical constraints and proposals.

The main product risks are overbuilding an ontology before observing real discussion, becoming a
metadata catalogue or a forum with decorative tags, replacing criticism with generic AI prose, and
attempting full video analysis too early. Annotation, citation, evidence, and cross-context
discovery must remain central to the experience.
