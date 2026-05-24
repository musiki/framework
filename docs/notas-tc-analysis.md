# NOTAS: Text-Cohesion Analysis (DIY TAACO)

**Status:** Design / next-phase  
**Context:** Live within the NOTAS db-note editor, accessed as a margin panel  
**Prior art:** TAACO, Coh-Metrix, RST Tool, UAM CorpusTool

---

## 1. What this is

A **thematic trace editor** that makes paragraph-level structure visible as the user writes. It is not a grammar corrector. It detects patterns:

- What role does each paragraph play (definition, example, synthesis, contrast…)?
- Which concepts are introduced, reused, transformed, or dropped?
- Where are the rhetorical gaps (introduced concept never returned to, sudden topic jump)?

The lens comes from **thematic progression** (Daneš 1974), **RST** (Mann & Thompson 1988), **cohesion analysis** (Halliday & Hasan 1976), and **genre moves** (Swales 1990). The implementation is custom, built into Musiki, not a port of any existing tool.

---

## 2. Anatomy of a trace

Every paragraph gets a **trace record**:

```typescript
type ParagraphTrace = {
  id: string;
  documentId: string;   // noteId
  index: number;        // paragraph order (0-based)
  textHash: string;     // sha1 of paragraph text — used to skip re-analysis
  mainTheme: string | null;
  concepts: ConceptMention[];
  rhetoricalRole: RhetoricalRole | null;
  relations: ParagraphRelation[];
  diagnostics: Diagnostic[];
  updatedAt: string;
};

type ConceptMention = {
  label: string;
  status: 'introduced' | 'reused' | 'transformed' | 'dropped' | 'synthesized';
  confidence: number;
};

type ParagraphRelation = {
  targetIndex: number;
  type:
    | 'extends' | 'contrasts' | 'exemplifies'
    | 'returns_to' | 'synthesizes' | 'problematizes'
    | 'supports' | 'transitions' | 'defines';
  evidence: string;
  confidence: number;
};

type RhetoricalRole =
  | 'claim' | 'definition' | 'context' | 'literature'
  | 'example' | 'analysis' | 'contrast' | 'transition'
  | 'synthesis' | 'method' | 'reflection' | 'conclusion';

type Diagnostic = {
  severity: 'low' | 'medium' | 'high';
  type:
    | 'orphan_concept'      // introduced, never returned to
    | 'unclosed_synthesis'  // promised synthesis not delivered
    | 'abrupt_transition'   // incompatible rhetorical roles adjacent
    | 'concept_drift'       // concept reused with shifted meaning
    | 'needs_bridge';       // synthesis without transition
  message: string;
};
```

---

## 3. Analysis pipeline

```
text saved / paragraph blurred
  → debounce 1200 ms
  → markdown AST → paragraph segments
  → local pass (fast, no AI):
      - lexical chains via lemma overlap
      - concept recurrence (repeat keywords)
      - simple role signals ("por ejemplo", "sin embargo", "en conclusión")
  → delta pass (only changed paragraphs)
  → LLM pass (optional, on demand or on section close):
      - structured JSON output (closed schema — no prose)
      - provider: Ollama (local) or Claude haiku (cloud)
  → merge into trace store
  → update margin panel
```

The local pass runs always and is cheap. The LLM pass is optional, triggered by the user (button or closing a section heading) — not on every keystroke.

### LLM prompt contract

The LLM receives paragraph text + prior traces (concept list) and must return strict JSON:

```json
{
  "rhetoricalRole": "synthesis",
  "mainTheme": "speculative organology",
  "concepts": [
    { "label": "embodied interface", "status": "synthesized", "confidence": 0.82 }
  ],
  "relations": [
    { "targetIndex": 0, "type": "returns_to", "evidence": "Reuses definition from P1.", "confidence": 0.87 }
  ],
  "diagnostics": [
    { "severity": "medium", "type": "needs_bridge", "message": "Synthesis lacks explicit transition." }
  ]
}
```

No prose, no explanations outside the schema. Hallucination risk is bounded because the schema is closed and confidence scores make uncertainty explicit.

---

## 4. UI: margin panel

The NOTAS panel splits horizontally on trace activation:

```
╔══════════════════════════════════╦══════════════════╗
║  live-md editor (main)           ║  trace margin    ║
║                                  ║                  ║
║  # My chapter                    ║  P0 [context]    ║
║                                  ║    ↓ extends     ║
║  Lorem ipsum...                  ║  P1 [claim]      ║
║                                  ║    ↓ exemplifies ║
║  For example...                  ║  P2 [example]    ║
║                                  ║    ↑ ⚠ orphan    ║
║  The final synthesis...          ║  P3 [synthesis]  ║
║                                  ║                  ║
╚══════════════════════════════════╩══════════════════╝
```

The margin is ~220 px, scrolls in sync with the editor. Each trace row:
- **Color chip** for rhetorical role (defined in a 12-color palette)
- **Role label** (editable — user can override AI classification)
- **Relation arrow** pointing to target paragraph
- **⚠ diagnostic badge** if any issues

A **graph view** (collapsible) shows the paragraph DAG: nodes are paragraphs, edges are relation types, color-coded.

---

## 5. Implementation phases

### P0 — Local analysis + manual annotation (no AI)
- Segment note body by blank lines → paragraphs
- Extract top-N lemmatized keywords per paragraph (simple frequency, stopword filter)
- Detect lexical chains: keywords appearing in ≥2 paragraphs
- Detect orphan concepts: introduced in one paragraph, absent in all following
- Render margin panel with role dropdown (manual), concept badges
- Persist traces in `live_note_traces` DB table (keyed by `noteId + paraIndex + textHash`)
- Graph view: basic SVG DAG

### P1 — LLM-assisted classification
- "Analyze structure" button → sends current note to LLM
- LLM classifies each paragraph's rhetorical role + relations
- Suggestions shown with confidence bars; user confirms or overrides
- Diagnostic list panel: orphans, gaps, abrupt transitions ranked by severity
- Compare versions: diff trace between autosave snapshots

### P2 — Corpus and export
- Cross-note concept graph (all NOTAS for a user)
- Metadiscourse density metric (guided by Hyland 2005 taxonomy)
- Export as structured report (PDF, JSON, or inline submission evidence)
- "Artistic mode" toggle: disables linear progression expectations, allows montage/fragment

---

## 6. DB schema (minimal P0)

```sql
CREATE TABLE live_note_traces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID NOT NULL REFERENCES live_notes(id) ON DELETE CASCADE,
  para_index  INTEGER NOT NULL,
  text_hash   CHAR(40) NOT NULL,
  main_theme  TEXT,
  role        TEXT,
  concepts    JSONB DEFAULT '[]',
  relations   JSONB DEFAULT '[]',
  diagnostics JSONB DEFAULT '[]',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (note_id, para_index)
);
```

---

## 7. Integration with NOTAS workspace

The trace panel is a **side panel within the db-note dockview shell**, not a separate pod. It activates via a toggle button in the panel header (beside the pencil). When off, the live-md editor uses 100% of the panel width. When on, the editor shrinks to ~65% and the trace margin fills the rest.

The save pipeline (`/api/live/notes`) remains unchanged. Traces are written to a separate table via `/api/live/notes/trace` (POST) and read via `/api/live/notes/trace?noteId=…`.

---

## 8. Modes

| Mode | Behaviour |
|---|---|
| `draft` | Analysis private, non-evaluative, no submission link |
| `seminar` | Trace visible to instructor on request |
| `thesis` | Full diagnostic report, version comparison |
| `artistic` | Disables linear-progression warnings, allows montage |
| `submission` | Snapshot of trace frozen with submission; no re-analysis |

---

## 9. Key risks

1. **False objectivity** — the tool detects structure patterns, not argument quality.
2. **Normalisation pressure** — avoid UI that scores or ranks; show patterns without verdict.
3. **LLM conservatism** — models favour conventional clarity; artistic/experimental writing needs explicit mode.
4. **Data sovereignty** — local Ollama is the default; cloud AI is opt-in per note.

---

## 10. Bibliography (seed)

```bibtex
@article{danes1974functional,
  author={Daneš, František}, year={1974},
  title={Functional Sentence Perspective and the Organization of the Text},
  journal={Papers on Functional Sentence Perspective}, pages={106--128}
}
@book{hallidayhasan1976cohesion,
  author={Halliday, M.A.K. and Hasan, Ruqaiya}, year={1976},
  title={Cohesion in English}, publisher={Longman}
}
@article{mannthompson1988rst,
  author={Mann, William C. and Thompson, Sandra A.}, year={1988},
  title={Rhetorical Structure Theory: Toward a Functional Theory of Text Organization},
  journal={Text}, volume={8}, number={3}, pages={243--281}
}
@book{swales1990genre,
  author={Swales, John M.}, year={1990},
  title={Genre Analysis: English in Academic and Research Settings},
  publisher={Cambridge University Press}
}
@book{hyland2005metadiscourse,
  author={Hyland, Ken}, year={2005},
  title={Metadiscourse: Exploring Interaction in Writing},
  publisher={Continuum}
}
```

---

## 11. The Unified Concept: Trace Codes

The convergence of three historically separate traditions produces a new primitive:

| Tradition | Unit | What it captures |
|---|---|---|
| CAQDAS | Code | Researcher-assigned theme on a text segment |
| RST / Cohesion | Trace | Structural role + inter-paragraph relation |
| LLM-assisted NLP | Suggestion | AI-inferred pattern with provenance |

A **Trace Code** collapses all three into one annotation unit:

```typescript
type TraceCode = {
  id: string;
  paragraphId: string;
  label: string;                          // "identity", "claim", "returns_to:P1"
  dimension: 'thematic' | 'rhetorical' | 'emergent' | 'manual';
  source: 'manual' | 'local_nlp' | 'ai_suggested' | 'ai_confirmed';
  model?: string;                         // e.g. "gemma3:27b" when source is ai_*
  confidence: number;                     // 1.0 for manual
  confirmedBy?: string;                   // userId if source moved from ai_suggested → ai_confirmed
};
```

The critical design principle: **manual codes and AI codes use exactly the same data model**. The `source` field records provenance; the UI adds a subtle visual indicator (a ✦ glyph or opacity shift). No separate "AI mode" — the margin panel shows all codes regardless of origin, sorted by confidence.

This means the user can:
- Code manually (CAQDAS workflow)
- Accept AI suggestions (AI-assisted workflow)
- Let AI run without review (autonomous trace)

All producing the same storable, queryable, diffable `TraceCode` records. Over multiple sessions, accepted AI codes become implicit training feedback for the prompt.

### Emergent quality

The genuinely new thing is the **emergent loop**:

```
user writes freely
  → AI suggests codes (no commitment required)
  → user confirms some, ignores others
  → confirmed codes across paragraphs form chains
  → chains surface patterns the user didn't consciously plan
  → user sees structure they were building without naming it
```

This is different from CAQDAS (top-down code schemes) and different from RST annotation (heavy structural pre-analysis). It's closer to how Obsidian's graph view reveals backlink structure the user wrote without noticing — except here it's semantic/rhetorical, not just lexical.

---

## 12. Review Architecture: Teacher–Student Annotations

When NOTAS notes move into a submission/review workflow, the trace system extends into a **review layer**. Trace codes become shared — teacher and student can both see and add them.

### Separation of concerns

| Layer | Storage | Owner |
|---|---|---|
| Document content | Markdown snapshot / live note body | Student |
| Trace codes | `live_note_traces` + `trace_codes` | Student (+ AI suggestions) |
| Comment threads | `comment_thread` + `comment_message` | Teacher ↔ Student |
| Comment anchors | `comment_anchor` | System (anchored to paragraph or text range) |
| Suggestion patches | `suggestion_patch` | Teacher proposes, student decides |
| AI feedback events | `ai_feedback_event` | System (teacher can promote to comment) |
| Review state | `review_session` | LMS (submission lifecycle) |

### Core schema

```sql
CREATE TABLE review_session (
  id             UUID PRIMARY KEY,
  submission_id  UUID NOT NULL,
  reviewer_id    UUID NOT NULL,
  reviewee_id    UUID NOT NULL,
  mode           TEXT NOT NULL, -- teacher | peer | ai_assisted
  status         TEXT NOT NULL, -- draft | submitted | returned | resolved | archived
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE comment_thread (
  id                 UUID PRIMARY KEY,
  review_session_id  UUID NOT NULL REFERENCES review_session(id),
  document_id        UUID NOT NULL,
  created_by         UUID NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'teacher_student',
  status             TEXT NOT NULL DEFAULT 'open', -- open | resolved | reopened | archived
  kind               TEXT NOT NULL DEFAULT 'margin_comment',
  -- margin_comment | suggestion | rubric_feedback | question
  -- required_change | praise | ai_diagnosis | peer_review
  severity           TEXT, -- note | suggestion | issue | required_change
  created_at         TIMESTAMPTZ DEFAULT now(),
  resolved_at        TIMESTAMPTZ
);

CREATE TABLE comment_anchor (
  id              UUID PRIMARY KEY,
  thread_id       UUID NOT NULL REFERENCES comment_thread(id),
  anchor_type     TEXT NOT NULL, -- text_range | paragraph | block
  from_pos        INT,
  to_pos          INT,
  paragraph_id    TEXT,           -- stable id for fuzzy-match fallback
  quote           TEXT,           -- verbatim selected text
  text_hash       TEXT,           -- sha1 of selected span
  context_before  TEXT,
  context_after   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE comment_message (
  id          UUID PRIMARY KEY,
  thread_id   UUID NOT NULL REFERENCES comment_thread(id),
  author_id   UUID NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  edited_at   TIMESTAMPTZ
);

-- Teacher proposes an edit; student accepts / rejects / modifies
CREATE TABLE suggestion_patch (
  id              UUID PRIMARY KEY,
  thread_id       UUID NOT NULL REFERENCES comment_thread(id),
  operation       TEXT NOT NULL, -- replace | insert | delete
  from_pos        INT,
  to_pos          INT,
  original_text   TEXT,
  suggested_text  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | accepted | rejected | modified
  decided_by      UUID,
  decided_at      TIMESTAMPTZ
);

-- AI feedback is never posted directly as a comment
CREATE TABLE ai_feedback_event (
  id                       UUID PRIMARY KEY,
  submission_id            UUID NOT NULL,
  provider                 TEXT NOT NULL,  -- ollama | claude
  model                    TEXT NOT NULL,  -- gemma3:27b | claude-haiku-4-5
  mode                     TEXT NOT NULL,  -- trace | rubric_assist | diagnosis
  input_hash               TEXT NOT NULL,
  output                   JSONB NOT NULL,
  converted_to_comment_id  UUID,           -- null until teacher promotes it
  created_at               TIMESTAMPTZ DEFAULT now()
);
```

### Anchor robustness

The hard problem is that `from_pos` / `to_pos` break when the document is edited outside the current session. Anchor survival strategy:

```
primary    → ProseMirror range (live, updated by transactions)
secondary  → paragraph_id + offset within paragraph
fallback   → quote + text_hash + context_before + context_after (fuzzy match)
```

On re-open: try primary → secondary → fuzzy. If fuzzy confidence < 0.7, mark anchor as `orphaned` and show a warning badge.

### AI involvement in review

AI generates `ai_feedback_event` records; a teacher explicitly promotes them to a `comment_thread` (source becomes `teacher_after_ai`). The student never knows the AI spoke first unless the teacher discloses it. This preserves pedagogical trust and avoids the AI-as-police failure mode.

---

## 13. AI Backend: Cloud Ollama via `ollama-api.zztt.org`

### How it actually works

The VPS at Hetzner does NOT run large models locally (avoids memory tilt). Instead, `ollama-api.zztt.org` is an **Ollama-compatible API proxy** that routes `:cloud`-suffixed models to free-tier cloud inference providers. The VPS handles authentication and request routing; the GPU work happens in the cloud.

**Models in use (from `OrfPanel.astro`):**
- `gemma4:31b-cloud` — Gemma 4 31B via cloud, **primary choice for trace analysis**
- `nemotron-3-super:cloud` — NVIDIA Nemotron 120B via cloud, for heavy reasoning

**Already working in production** — ORF chat in room.astro uses this exact path and works smoothly.

### Existing API pattern (reuse for Trace)

```
POST /api/ai/correct   (Astro endpoint)  →  ollama-api.zztt.org/api/correct
POST /api/ai/run       (Astro endpoint)  →  ollama-api.zztt.org/api/run
```

Auth: `Authorization: Bearer ${CORRECTION_API_TOKEN}` (env var already set).

The trace endpoint follows the same pattern:
```
POST /api/ai/trace     (new Astro endpoint)  →  ollama-api.zztt.org/api/correct
```

Uses `gemma4:31b-cloud` with `promptOverride` (closed JSON schema prompt). The `parseJsonLoosely` utility already in `correct.ts` handles model output quirks.

### Task breakdown

| Task | Model | Latency target |
|---|---|---|
| Per-paragraph code suggestions (on demand) | `gemma4:31b-cloud` | ~3-5s |
| Full document structural analysis | `gemma4:31b-cloud` | ~10-15s batched |
| Heavy reasoning / rubric assist | `nemotron-3-super:cloud` | ~15-30s, explicit trigger |

### Prompt contract (per-paragraph)

```typescript
type TracePromptInput = {
  paragraphText: string;
  priorConcepts: string[];     // labels confirmed so far in this document
  priorRoles: string[];        // rhetorical roles of preceding paragraphs
  documentContext: string;     // first paragraph + section heading (context anchor)
};

type TracePromptOutput = {
  rhetoricalRole: RhetoricalRole;
  mainTheme: string;
  concepts: Array<{
    label: string;
    status: 'introduced' | 'reused' | 'transformed' | 'dropped' | 'synthesized';
    confidence: number;
  }>;
  relations: Array<{
    targetIndex: number;
    type: ParagraphRelationType;
    evidence: string;
    confidence: number;
  }>;
  diagnostics: Diagnostic[];
};
```

Closed schema → structured JSON output (`--format json` in Ollama API). No prose fields. Low hallucination risk because the concept list is seeded from prior confirmed codes in `priorConcepts`.

### Latency budget

| Event | Target | Strategy |
|---|---|---|
| Per-paragraph suggestion (on blur) | < 3s | Single paragraph, small prompt |
| Section analysis (on heading closure) | < 8s | Batch 3-5 paragraphs |
| Full document trace | < 30s | Background job, websocket notify |
| Teacher rubric assist | < 5s | Claude Haiku, cloud |

---

## 14. Where to Begin: Stage 0 Recommendation

The question of where to start is architectural, not just technical. The goal is to validate the **unified Trace Code concept** while delivering something useful to teachers and students immediately.

### The thesis

Manual annotation and AI annotation are the same operation. Build the annotation UI first. Point it at a human first. Plug in AI second. The UI doesn't change.

### Stage 0 — Manual Trace Codes in the Margin (no AI)

**What to build:**

1. **Paragraph splitter** — on note save, split body on double-newline → emit `paragraph_id` per segment (stable hash of position + content prefix)
2. **Margin panel toggle** — a `⊕` button in the db-note shell header, splits panel 65/35
3. **Code tagger** — click any paragraph row in margin → `input[type=text]` → Enter → creates `TraceCode { source: 'manual', confidence: 1.0 }`
4. **Chain highlight** — click any code label → all paragraphs with that code get a left-border highlight in the editor (CodeMirror `Decoration.line()`)
5. **Orphan detection** — local-only: any code label appearing only once gets a faint `⚠` badge (no AI needed)

**What this proves:** the data model works, the UI feels right, the margin panel is useful before any AI exists.

**Exact files to create:**
```
src/scripts/course/notes/trace-margin.ts          ← margin panel UI
src/pages/api/live/notes/trace.ts                 ← GET/POST trace codes
src/scripts/course/dockview-workspace.ts          ← add toggle button + mount margin
```
**DB migration:** `ALTER TABLE` or new `trace_codes` table (see §6).  
**Estimated size:** ~400 lines total.

### Stage 1 — Local NLP pass

After S0 is stable:
- Lemmatize paragraph text (simple JS implementation, no external dep)
- Detect keyword chains (same keyword in ≥2 paragraphs → suggest code = keyword)
- Show suggestions with low confidence dots; user confirms with a single click

### Stage 2 — Gemma 4.7 / 32B integration

After S1 is stable:
- "Analyse structure" button → POST to `/api/ai/trace`
- Backend calls Ollama with the closed-schema prompt
- Response populates `TraceCode` rows with `source: 'ai_suggested'`
- User confirms/dismisses; confirmed → `source: 'ai_confirmed'`

### Stage 3 — Review layer

After S2 is stable and NOTAS is used in real submissions:
- `review_session`, `comment_thread`, `comment_anchor` tables
- Teacher opens note in review mode → same margin panel, new "Comment" action
- AI suggestions surfaced to teacher as `ai_feedback_event` (teacher promotes or ignores)

### The emergent value

By Stage 2, the system has:
- Manual CAQDAS-style codes (user's conceptual vocabulary)
- AI-suggested structural codes (RST/cohesion layer)
- Cross-paragraph chains (emergent patterns the user didn't plan)

This is the thing that doesn't exist in any current tool. CAQDAS tools (NVivo, MAXQDA) require pre-defined code schemes. TAACO/Coh-Metrix produce fixed metrics. Neither shows you patterns emerging *as you write*. The Trace Code loop does.

**Start with Stage 0. The rest follows naturally.**
