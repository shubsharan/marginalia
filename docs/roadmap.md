# Development roadmap

[Product](product.md) · [Architecture](architecture.md)

Build Marginalia as a connected application for exploring film and television, inspecting evidence,
and discussing specific ideas and moments. The development flow follows how the product works:
content enters a shared knowledge model, readers explore it, contributions enrich it, and discovery
uses those relationships to help people find more.

The sections below are engineering epics. Each contains proposed feature-spec briefs that describe
complete workflows across storage, server behavior, and UI. Their order explains how the application
grows; it is not a serial task queue or a set of business-validation gates. The full consumer
product is in scope. Commercial offerings and automated full-video analysis remain outside it.

F-identifiers identify features, not completed spec documents or build steps. No feature spec files
have been created yet. Each entry below explains its purpose, implementation scope, and completion
scenario so it can become a spec. F00 names the application runtime work that previously had no ID.
F23 is explicitly a family of target-specific specs. These are planned capabilities, not implemented
functionality.

## 1. Application foundation

Establish a running product that can read and write persisted data. The repository currently
contains workspace tooling and shared TypeScript configuration; product runtime and persistence
choices still need to be made.

### F00 Application runtime

Give developers a working application to build product features in.

- Build: Set up the web app, server boundary, persistence, migrations, environment configuration,
  application shell, and deployable build. Document local startup and add a smoke check. Select the
  concrete stack in its implementation plan.
- Complete when: A fresh checkout starts against a configured database, applies migrations, and
  serves a page backed by persisted data. The build can be deployed. Validate product writes through
  F01 rather than inventing a throwaway domain.

### F05 Accounts and access

Let people sign in and ensure each person can perform only the actions their role permits.

- Build: Implement sessions, contributor identity, account controls, ownership checks, and curator
  and moderator permissions. Apply authorization at server operations as well as in the UI.
- Complete when: A person can sign in and out. A contributor can edit their own annotation, but
  cannot edit another person's contribution or access curator and moderator operations without the
  relevant role.

### Development approach

Prove the runtime through the catalogue work below: seed a work, read it from persistence, render
its page, and save an authorized correction. Build the foundation and this first feature together so
infrastructure choices have a working use case. Add deployment configuration and a smoke check for
that path. Avoid a separate exercise in designing infrastructure for every future feature.

**Working result:** A developer can run the application with seed data, sign in, open a work, and
persist an authorized edit. The same application can be built and deployed.

## 2. Knowledge model and browsing

Give works, concepts, claims, and sources one consistent representation, then expose that model
through pages readers can navigate. This is the core of the product.

### F01 Catalogue and work pages

Give every film or television work a stable home that readers can open and curators can maintain.

- Build: Define work records and metadata, catalogue listing and detail queries, work pages, and
  curator create and edit forms. Seed development works through the same write behavior used by the
  application.
- Complete when: A curator creates a work and corrects its metadata. A reader finds it in the
  catalogue and opens its page. Renaming it preserves existing links.

### F03 Sources, claims, and evidence

Make statements about a work inspectable: what is claimed, whether it is interpretation, and what
supports or challenges it.

- Build: Define sources, source locations, claims, evidence relationships, permitted-use metadata,
  and revisions. Add curator entry forms and reader evidence views. Retain original observations
  when they enter the system.
- Complete when: A reader opens a claim and follows its supporting or opposing evidence to a source
  location. Earlier claim wording remains recoverable. Missing support is visible, and source text
  is displayed only as permitted.

### F02 Genomes, concepts, and traversal

Explain what a work contains and how it connects to other works through shared ideas and techniques.

- Build: Define concepts, typed genome properties, work memberships, and typed concept
  relationships. Build genome editing and display, concept pages, evidence links, and related-work
  navigation. This includes the former F13 concept pages and F27 traversal.
- Complete when: A reader follows a genome entry from a work to a concept, inspects the evidence,
  and reaches another work through an explained connection. A curator can maintain those entries and
  relationships.

### Development approach

Design these records and relationships together, then implement them through their owning features.
Use consistent IDs, object types, links, and revision behavior. A source supports a claim; a claim
can support a genome entry; that entry links a work to a concept. The UI should make that chain
inspectable. A concept page reads the same records as a work page.

Keep source references and semantic relationships distinct: evidence explains why a statement is
supported, while a relationship explains how objects are connected. A shared identity convention
does not require storing every kind of object in one generic table.

**Working result:** A reader opens a work, inspects its genome and evidence, follows a concept, and
finds another related work. A curator can maintain that entire experience inside the application.

## 3. Content ingestion and publishing

Populate the knowledge model without requiring every claim and connection to be entered by hand.
Manual curation remains available for corrections and original editorial work.

### F11 Source import

Bring permitted external material into the application so it can be processed without manual
copying.

- Build: Implement source submission, one concrete source adapter, retrieval or upload, import job
  status, retry handling, and source-specific retention. Store imported material separately from
  published graph content. Import prepares material; F12 interprets and publishes it.
- Complete when: A curator submits a source, sees whether retrieval succeeded, and can inspect or
  retry a failed import. Repeating an import does not create duplicate source records. Disallowed
  collection is blocked.

### F12 Extraction and publication

Turn imported material into useful work-page content with evidence that readers can verify.

- Build: Extract observations and claims, resolve works and concepts, attach supporting source
  locations and extraction details, and publish through the existing content write operations.
  Provide output inspection and correction. The spec defines publication behavior for uncertain or
  unsupported results.
- Complete when: A source produces claims attached to the correct work with inspectable evidence.
  Reprocessing does not duplicate publication. Conflicting interpretations remain distinct, and
  failed or unsupported extraction is visible.

### Development approach

Follow one import end to end: source input, extraction, entity resolution, evidence-backed records,
and visible work and concept content. Make repeated imports and retries safe from duplicate
publication. Use the knowledge model's write operations for both ingestion and manual curation. The
ingestion plan chooses job execution and recovery behavior for this concrete workflow.

Ingestion must retain disagreement between sources. Importing another interpretation adds evidence
or a competing claim; it must not silently replace an existing interpretation. Record the source
location and extraction version with each derived observation.

**Working result:** A curator submits a permitted source, follows its processing status, inspects
the resulting claims, and sees published content on the relevant pages with traceable evidence.

## 4. Annotation and connected discussion

Let people contribute directly to what they are reading and carry that discussion across related
works and concepts.

### F06 Text and concept annotations

Let someone comment on an exact passage or concept rather than only on an entire work.

- Build: Implement text selection and concept targeting, the annotation composer, publish and edit
  operations, direct links, and target rendering. Store one primary target, quoted text and position
  where applicable, and original contribution context.
- Complete when: A reader selects a phrase, publishes an annotation, and reopens it at that phrase.
  Supported edits retain or reattach the target. If the phrase disappears, the annotation shows an
  unresolved target instead of moving silently.

### F07 Object citations

Let contributors support an argument by referencing another item in Marginalia.

- Build: Add citation selection to composition and editing, persistent object references with
  context, and citation rendering and navigation. Support works, concepts, claims, sources, and
  annotations using their existing identities.
- Complete when: An annotation cites a claim and another annotation. Readers can open both targets
  after a label or layout change. A removed or inaccessible target produces an explicit unavailable
  reference.

### F08 Replies and discussion navigation

Let people respond to contributions and follow a conversation without losing its original subject.

- Build: Implement reply composition and editing, parent-child contribution relationships, thread
  queries, pagination, and navigation to the original annotation target. Preserve reply context and
  revisions alongside annotations.
- Complete when: A person replies to an annotation, another reader follows the reply to its parent
  and original target, and more discussion loads on demand without fetching the entire thread.

### F04 Evidence-backed debates

Organize competing answers to a contested question so readers can compare their arguments.

- Build: Represent a debate question and its interpretations, connect each position to claims and
  supporting or opposing evidence, and build the comparison view and curation controls. Reuse
  evidence records rather than duplicating source material.
- Complete when: A reader opens a question such as whether Deckard is a replicant, compares distinct
  positions, and inspects each position's evidence. The page preserves disagreement rather than
  presenting a fabricated consensus.

### F24 Interpretation and correction history

Show how an argument changed and which evidence or correction caused that change.

- Build: Build revision queries and history views over claim and contribution revisions retained by
  their owning features. Connect corrections to the statements and evidence they address. This
  feature presents history; it does not defer recording revisions until this UI exists.
- Complete when: A reader compares an earlier interpretation with its corrected version and follows
  the cited reason for the correction. The earlier wording remains available subject to visibility
  and retention rules.

### F09 Related-context discussion

Make a useful contribution discoverable wherever its subject is relevant without copying the
discussion.

- Build: Define the explicit relationships that qualify an annotation for related work and concept
  views. Add bounded queries and UI placements that show the reason, original target, citations, and
  a link to the discussion.
- Complete when: The same annotation appears at its target and on a related concept page. Editing it
  updates both views of one identity. A reader can return from either view to the original
  discussion.

### F10 Moderation and spoilers

Give readers control over spoilers and moderators a usable way to handle abusive contributions.

- Build: Implement reporting, a moderation review view, moderator actions, contribution visibility,
  spoiler marking, and reveal controls. Apply the resulting visibility decisions to direct reads and
  all projected views.
- Complete when: A moderator acts on a report and the hidden contribution disappears from ordinary
  display everywhere. References remain explicitly unavailable. Spoiler content stays concealed
  until the reader reveals it.

### F17 Participation safeguards

Handle abuse that involves accounts, request volume, or source material rather than a single
contribution.

- Build: Add participation limits, impersonation reports, source and copyright complaints, and the
  appropriate review and action paths. Reuse moderator roles and reporting mechanisms from F10.
- Complete when: Excess participation requests receive a clear rejection. A moderator can
  investigate an impersonation report or source complaint and apply an action to the affected
  account or material.

### Development approach

Design the complete interaction: select a passage, write an annotation, cite a claim, publish,
reply, and encounter the same contribution through a concept. An annotation targets content; a reply
addresses a contribution. Both should remain navigable without loading the entire discussion.

Editing or removing a target must preserve its references or expose an unresolved state. A hidden
contribution must not remain visible through projection, search, or a direct link. Build moderation
alongside contribution publishing so it uses the same identity and visibility rules.

**Working result:** A person can start an evidence-backed discussion at a precise target, continue
it from another context, and inspect how an interpretation changed. Moderators can manage it
everywhere it appears.

## 5. Search and discovery

Use the content and relationships already in the application to help readers find works and ideas.

### F15 Semantic search

Let readers find relevant works, concepts, and claims by describing an idea.

- Build: Implement indexing, query handling, result ranking and presentation, and updates when
  content changes. Include enough evidence and relationship context to explain relevance. Support
  curated content independently of ingestion.
- Complete when: A query such as institutional politics returns relevant content from an agreed
  example set. A reader understands each result's context, and edited or hidden content is reflected
  in subsequent results.

### F16 Related-work recommendations

Help readers find another work based on the qualities of the one they are exploring.

- Build: Generate related-work candidates from genome properties and relationships, rank them, and
  display the attributes responsible for the recommendation. This feature uses work content without
  requiring personal preferences.
- Complete when: A work page suggests another work and explains the shared qualities. Changing the
  underlying genome changes applicable recommendations rather than leaving stale explanations.

### F28 Private discovery preferences

Let a person tell the product which qualities they want more or less of.

- Build: Implement private preference storage, retrieval, editing, removal, and account controls for
  desired and unwanted concepts or attributes. Decide explicitly in the spec whether inferred
  behavior is included.
- Complete when: A person saves and removes a preference such as wanting procedural realism or
  avoiding lore-heavy exposition. Another account cannot read or change those preferences.

### F29 Personalized recommendations

Use a person's preferences to suggest works and explain why those suggestions fit.

- Build: Combine related-work recommendation behavior with private preferences, apply desired and
  unwanted qualities, and show explanations with a path to change the relevant inputs.
- Complete when: Two different preference sets can produce different suggestions from the same
  catalogue. A person can inspect a recommendation's reason and adjust the preference responsible
  for it.

### Development approach

Treat indexes and recommendation results as derived from the shared knowledge model. Define how
content changes, moderation, and concept changes update or invalidate them. Compare relevance using
concrete queries and example works. Keep private preferences separate from publicly visible content.

**Working result:** A reader searches for an idea, understands why a work matches, follows related
works, and adjusts recommendations through their own preferences.

## 6. Scenes and richer media interaction

Extend the same exploration and discussion model to moments within a work.

### F14 Scenes and time targets

Let readers open, annotate, and cite a specific moment within a work.

- Build: Define scene records, time ranges, metadata, and permitted media references. Add scene
  curation and detail views, time selection, and target resolution using the existing annotation and
  citation behavior.
- Complete when: A reader cites a scene or time range and another reader opens the intended moment.
  A metadata edit preserves the target or exposes an unresolved state. Hosted full-length video is
  not required.

### F30 Semantic timelines

Help readers see where scenes, techniques, and discussion occur throughout a work.

- Build: Build timeline queries and a timeline view over scene and time records, associated concepts
  or techniques, and contributions. Connect timeline entries to their existing scene and discussion
  views.
- Complete when: A reader locates a technique or active discussion on the timeline and jumps to its
  scene context. The UI makes missing scene coverage visible rather than implying a complete
  analysis.

### F23 Additional target experiences

Extend precise discussion to material that text ranges and timestamps cannot address.

- Build: This is a family of target-specific specs, not one universal selector spec. Each selects a
  concrete target such as an image region, logical chart datum, or another annotation and defines
  selection, storage, rendering, resolution, and edit behavior. Reviews and votes require their
  owning features to exist.
- Complete when: For each selected target type, a reader can identify a precise part, annotate or
  cite it, and reopen the same part after supported edits. Chart targets use logical data IDs rather
  than screen pixels.

### Development approach

Reuse annotation ownership, citation, discussion, and moderation behavior. Add the selector and
rendering behavior specific to each medium. Use logical data identities for chart targets and
explicit time ranges for scenes. Curated scene records are sufficient; full-video analysis is not
part of this work.

**Working result:** A reader moves along a work's timeline, opens a scene or technique, and joins a
precisely located discussion using the same contribution tools as the rest of the application.

## 7. Concept maintenance and formation

Keep the concept system usable as curation, imported sources, and discussion introduce new language.

### F21 Concept aliases and merges

Help curators reconcile different names for the same idea and duplicate concept records.

- Build: Implement alias editing, merge preview and execution, reference and membership handling,
  change history, and reversal. Preserve original source and contributor expressions rather than
  rewriting them to the preferred label.
- Complete when: A curator merges duplicate concepts. Old links remain usable, memberships are
  retained, and the recorded change can be inspected and reversed.

### F22 Concept splits and deprecation

Let curators separate meanings that were combined incorrectly or retire a misleading concept.

- Build: Implement split and deprecation operations, membership reassignment, explicit treatment of
  ambiguous references, visible retired-concept states, change history, and reversal.
- Complete when: A curator splits a concept into distinct meanings and identifies memberships
  needing review. Existing references retain context. Retiring or reversing a concept change does
  not silently discard its observations.

### F19 Candidate concepts and relations

Find potential concepts and relationships in language already used by sources and contributors.

- Build: Process preserved observations into clusters and proposed concepts, aliases, memberships,
  or typed relations. Store candidate evidence and build inspection views with examples,
  counterexamples, and disputed boundaries.
- Complete when: A reviewer can trace a proposal to the original observations and inspect why it was
  suggested. Candidate generation alone makes no canonical concept changes.

### F20 Candidate review and promotion

Turn useful proposals into deliberate, accountable concept changes.

- Build: Implement review decisions, proposal revision, and application of accepted changes through
  validated concept operations. Record the reviewer, evidence, resulting change, and reversal path.
  Support human resolution of contested meanings.
- Complete when: A reviewer accepts, revises, or rejects a proposal. Acceptance makes a traceable,
  reversible change with compatible references; rejection leaves canonical concepts unchanged.

### Development approach

Concept editing works directly on curated concepts. Candidate generation is another producer of
proposed changes, not a prerequisite for maintaining the ontology. Accepted proposals use the same
validated change operations. Preserve original observations so a merge or split can reinterpret
membership without rewriting what people or sources said.

**Working result:** A curator can correct the ontology, inspect and reverse the change, and review
an evidence-backed proposal without breaking existing work pages, citations, or discussions.

## 8. Contribution value and reputation

Help contributors understand how their work is used and help readers assess expertise.

### F25 Contribution activity

Show contributors how their work is being discovered, cited, and corrected.

- Build: Record the relevant activity, aggregate it by contribution, and build an activity view.
  Define measurement start and retention so displayed counts reflect recorded activity without
  exposing individual readers or private preferences.
- Complete when: A contributor can inspect citation, discovery, and correction activity across
  contexts. The view identifies its measurement period and does not invent events from before
  tracking began.

### F26 Domain-specific reputation

Help readers assess a contributor's expertise in a subject using their actual contribution history.

- Build: Define evidence-backed reputation rules, calculate subject-specific results, and expose the
  supporting contributions. Evaluate popularity bias and coordinated activity. Include voting-abuse
  controls if voting is introduced.
- Complete when: A reader can inspect the evidence behind a reputation result. Evaluation cases
  distinguish useful cited corrections from raw activity or coordinated promotion.

### Development approach

Use the existing contribution identities, citations, and corrections. Keep activity measurement
separate from reputation rules so those rules can change without losing their supporting evidence.
Avoid making contribution value depend on a follower count or unexplained score.

**Working result:** Contributors can inspect how their work is used, and readers can understand the
evidence behind a claim of subject expertise.

## Turning the roadmap into specs

Start by designing the application foundation and knowledge model together. The first running
workflow is a persisted work with editable metadata, a sourced claim, and a linked concept. Extend
that workflow through ingestion and connected discussion, then build discovery from the resulting
records. Media, concept maintenance, and reputation have their own cohesive workflows and can
progress when the records they use exist.

Each feature spec defines the user interaction, domain records it owns, server operations, UI views,
and end-to-end completion scenarios. Its implementation plan selects concrete technology, schemas,
interfaces, migration behavior, and tests. Record a dependency where it affects the design; do not
create a separate scheduling exercise for every shared record.

Identity, evidence provenance, source rights, privacy, reference compatibility, and moderation apply
throughout these workflows. Verify supported edits and failure states as part of the owning feature.
Check user-facing workflows on desktop and mobile. Broad ingestion retains source-rights and legal
review requirements. Research and corpus-size estimates inform iteration rather than block delivery.

## Scope references

F13 concept pages and F27 concept traversal are incorporated into F02. F18 observation preservation
is part of source, annotation, reply, and ingestion records from creation. These IDs do not need
separate specs. F00 adds application setup work missing from the earlier feature list.

An initial dataset of roughly 10–20 works is a development convenience. The earlier estimates of
100–500 works and 100–200 concepts describe possible content growth, not architectural thresholds.
Research can examine precise annotation, discovery across contexts, return visits, interpretation
quality, and recommendation relevance while development continues.

Commercial opportunities remain outside the consumer specs:

- **F31 Semantic API.** Let external applications query structured works, concepts, claims, and
  permitted provenance through a defined access contract.
- **F32 Research and trend tools.** Let researchers examine aggregate cultural patterns over time,
  with data coverage and uncertainty visible.
- **F33 Audience intelligence.** Help customers study aggregate audience patterns without exposing
  individual behavior or personal profiles.
- **F34 Partner recommendation infrastructure.** Deliver recommendation capabilities to other
  products with defined inputs, explanations, and evaluated quality.
- **F35 Ontology licensing.** Distribute a versioned concept dataset with provenance, permitted
  uses, and a process for consuming changes.

Professional critic and scholar tools, collections and exports, referrals, and sponsorship also
remain uncommitted. Any commercial offering needs its own demand, rights, and privacy decisions.
