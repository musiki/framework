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
