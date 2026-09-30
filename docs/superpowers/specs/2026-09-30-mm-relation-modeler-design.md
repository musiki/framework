# mm Relation Modeler — design

Status: decisions approved by the user on 2026-09-30 (curators/admins create types; space-wide vocabulary; stage 1 includes relations-as-concepts, logical properties + inference, visible agreement, emergence timeline).

## Goal

Relations are half of the modelling work in the Concept Machine. Today `ConceptRelation.type` is one of five fixed strings drawn with fixed line styles. The Relation Modeler makes relation **types** first-class, shared vocabulary of the space: definable, discussable, visually encoded (line or area), logically characterised, and traceable over time — without leaving the MishMash visual identity.

## Golden rule (design)

MishMash identity is flat: no gradients, no shadows, no rounded corners; ink rules. Colours come only from the brand tokens (`--mm-green`, `--mm-purple`, `--mm-blue`, `--mm-pink`, `--mm-yellow`, `--mm-red`, `--mm-ink` and their `*-tint`s, `--mm-purple-text` for text). A relation type chooses a **palette slot**, never a free colour. Every type is distinguishable without colour: colour + stroke pattern (or area pattern) together. Text on tints is always ink.

## Concepts

### RelationType (space-wide)
- `slug`, `label` (en), `labelNb?`, `inverseLabel?` (+ nb) — reading from the other end ("contains" / "is contained in").
- Visual encoding: `render` = `line` | `area`; `stroke` = `solid` | `dashed` | `dotted` | `double`; `arrow` = boolean; `color` = palette slot; `position` for legend order.
- Logical properties: `symmetric`, `transitive`, `hierarchical` (implies directed, acyclic: used by the taxonomy lens and area rendering), optional mappings `skos` (e.g. `skos:broader`) and `wikidata` (e.g. `P527`) for export.
- It is also a **concept-like entity**: it has a definition with credited versions (en, nb) and a discussion thread, reusing the concept machinery (a `Concept` row of kind `relation-type` linked 1:1, so definitions, adoption, history and rendering come for free). It does not appear as a node in the concept graph; it appears in the modeler table and has its own page `/r/<slug>`.
- Built-in types (seeded, editable but not deletable): derives (directed, transitive), combines (symmetric), contrasts (symmetric, dashed), reformulates (directed), exemplifies (directed, dotted). New example: contains (directed, hierarchical, transitive, `area`).
- Permissions: create/edit/archive = curator, admin (`manageRelationTypes`); archive instead of delete when relations use it.

### Relation (instance)
- As today (source, target, type → now FK to RelationType), plus provenance: `createdBy`, optional `fromPostId` (the post where it was argued).
- **Agreement**: members (not guests) mark `agree` / `disagree` on a relation, one stance per user, changeable. Public shows counts only (no names; names visible to the member themselves and curators).
- `area` relations: a container concept and its members; rendered as a hull.

### Inference (read-only, computed)
- For `transitive` types: closure over asserted relations (bounded depth, cycle-safe) → inferred relations, flagged `inferred: true`, never stored, never votable, drawn faint.
- For `symmetric` types: a relation reads the same from both ends (no arrow, one label).
- `inverseLabel` used when the focused node is the target.
- `hierarchical` types must stay acyclic: creating a relation that closes a cycle is rejected (409).

### Timeline
- Every concept, relation and relation type has `createdAt`; the graph payload includes them. A slider (with play/pause, reduced-motion aware, keyboard operable) filters the graph to "as of date": nodes/relations appear in order; status shown is the current one (status history is out of scope for stage 1 — note it).

## UI (graph page `/graph`)

- **Modeler table** under the graph: one row per relation type — swatch (line sample or area sample drawn in SVG), label / inverse, properties (symmetric · transitive · hierarchical), count of relations, visibility checkbox (the table is the legend and the filter), link to its page. Curators see "Add relation +" and per-row Edit/Archive, reorder.
- **Add / edit form**: label(s), inverse label, render (line/area), stroke, arrow, palette slot (radio swatches from brand tokens with names), properties checkboxes (with one-line explanations), optional SKOS/Wikidata mapping, initial definition (English required).
- **Graph rendering**:
  - line types: colour + stroke pattern + optional arrowhead; `double` as two parallel strokes.
  - area types: a flat hull (convex hull with padding, straight segments — no rounded corners) around container + members, tint fill of the palette slot, 2px ink-ish border in the slot colour, label on the hull edge; nested areas allowed; members attracted together by a weak force.
  - asserted vs inferred: inferred drawn thin, low opacity, never labelled unless focused.
  - agreement: stroke width scales with net agreement (bounded 1–4px); contested (disagree ≥ agree, with ≥ 2 stances) drawn with a "broken" pattern and a small square marker; tooltip/card shows counts.
  - hover card (already being built for concepts) also exists for relations: type, direction sentence ("A derives from B"), proposer name, origin post link, agree/disagree buttons for members.
- **Lenses** are out of stage 1 except the visibility filter (taxonomy/argument/mereology lenses later).
- Accessible fallback: the server-rendered relations table gains type, inferred flag, agreement counts; the modeler table is plain HTML.

## API (all via mmRoute; tenant mm; CSRF; rate limits)

- `GET /api/mm/relation-types` (public), `POST` (curator), `PATCH /api/mm/relation-types/[slug]` (curator), `PUT /api/mm/relation-types` order.
- `POST /api/mm/relations` accepts `typeSlug` (+ optional `fromPostId`); `POST /api/mm/relations/[id]/stance` `{stance: 'agree'|'disagree'|null}` (member+).
- `GET /api/mm/graph` adds `relationTypes`, per-edge `type`, `inferred`, `agree`, `disagree`, `createdAt`; per-node `createdAt`.
- Public export `/api/public/mm/concepts.json` adds `relation_types` (label, label_nb, inverse, properties, mappings, definition) and keeps names-only credits; optional `?format=jsonld` later.

## Data model (migration)

- `RelationType`(id, spaceId, conceptId → Concept (kind relation-type), slug, label, labelNb, inverseLabel, inverseLabelNb, render, stroke, arrow, color, symmetric, transitive, hierarchical, skos, wikidata, position, isBuiltin, isArchived, createdBy, timestamps); unique (spaceId, slug); CHECKs on enums and palette slots.
- `Concept.kind` text default 'concept' CHECK in ('concept','relation-type'); relation-type concepts excluded from concept lists/graph nodes.
- `ConceptRelation.typeId` FK → RelationType (backfill from the existing `type` strings; keep `type` column in sync for one release, then drop later); `fromPostId` FK ForumPost ON DELETE SET NULL.
- `ConceptRelationStance`(relationId, userId, stance CHECK, timestamps, PK (relationId,userId)), FKs ON DELETE CASCADE.
- Owner `app` guard as in previous mm migrations; idempotent; seed built-in types per existing commons space.

## Testing

Pure cores with fakeQuery: type CRUD + permissions, palette/enum validation, built-ins not deletable, relation creation by typeSlug, hierarchical cycle rejection, inference (transitive closure bounded, cycles, symmetric), stance rules (one per user, guests denied, counts only), graph payload shape (no user ids), export shape, timeline filtering helper. Rendering helpers (hull with padding, stroke pattern map, agreement → width) unit-tested. Browser check with the harness: add type "contains" as area, create relations, vote, inferred edges, slider.

## Out of scope (stage 2)

Lenses (taxonomy tree / argument / mereology layouts), n-ary relations (hyperedges), status history on the timeline, JSON-LD export, per-group vocabularies, free colours.
