# AGENTS.md — Musiki Framework Map of Content

Welcome, Agent. This project is a complex LMS/Wiki system built with Astro. Use this map to navigate the documentation in `/docs`.

## 📂 Documentation Categories

### 🏛️ Architecture & Core
- [LMS Architecture](docs/plans/2025-12-13-lms-architecture.md) — High-level system design.
- [URL Strategies](docs/estrategias%20de%20url.md) — Routing, slugs, and permission resolution.
- [Auth Configuration](docs/auth.config.ts) — Authentication flow details.
- [Notes Types](docs/notes-types.md) — Data structures for system notes.

### 📝 Content & Sync
- [Content Sync Setup](docs/content-sync/content-sync-setup.md) — How content is synchronized.
- [Adding Subjects](docs/content-sync/comoAgregarMaterias.md) — Guide for content creators.
- [Materia Repo Bootstrap](docs/materia-repo-bootstrap.md) — Scaffolding new content repos.

### 🎓 Evaluation & Self-Assessment (P0 Focus)
- [P0 Execution Plan](docs/plans/p0-execution.md) — Current priority: Self-assessment features.
- [Evaluation Ollama Migration](docs/evaluation/Evaluation%20ollama-migration.md) — AI-assisted evaluation.
- [MCQ Checklist](docs/evaluation/phase2-mcq-checklist.md) — Multi-choice question status.

### 🎥 Live Events & Room
- [Live Events Protocol](docs/live-events-protocol.md) — Real-time event communication.
- [Room Mermaid Diagram](docs/room/roomMermaid.md) — Component relationship in the room stage.
- [Media Sync](docs/room/media-sync.md) — Playback synchronization details.

### 🛠️ Infrastructure & Ops
- [VPS Framework Runtime](docs/content-sync/vps-framework-runtime.md) — Production environment specs.
- [Database Management](docs/db/database-management.md) — Backup and persistence.
- [Ollama VPS Workflow](docs/ollama-vps-workflow.md) — Local AI integration.

## 🗺️ Current Work (GSD)

Active milestone: **REFURBISH: Workspace Hospital** — Fixing workspace regressions (LilyPond, Audio, Dockview, Search).

- [refurbish-workspace.md](.planning/plans/refurbish-workspace.md) — Implementation plan
- [PROJECT.md](.planning/PROJECT.md) — Project context and goals
- [ROADMAP.md](.planning/ROADMAP.md) — Phase breakdown (2 phases)
- [REQUIREMENTS.md](.planning/REQUIREMENTS.md) — 5 requirements (AUDIO-01/02, WSPC-01/02/03)
- [STATE.md](.planning/STATE.md) — Current project state

**Current priority:** Phase 1 — `src/scripts/room/hyperpiano/HyperpianoController.ts`
Run `/gsd-plan-phase 1` to start.

---

### 🎥 Room — Pod Layout Docs (current focus)
- [Pod Layout Architecture](docs/room/pod-layout.md) — Dockview pod system design.

## 🛠️ AGENT RULES & BEST PRACTICES

1.  **Log All Changes in `MEMORY.md`**: Every significant change, bug fix, or feature addition must be recorded in `MEMORY.md` with the current date, commit hash, and a brief description of the impact.
2.  **CSS Hierarchy & Minimalist Style**: 
    *   Prioritize centralized `src/styles/global.css` for cross-component styles.
    *   Maintain a coherent, minimalistic design using CSS variables (`var(--c-*)`).
    *   Use scoped CSS in `.astro` files only for component-specific overrides or unique layouts.
3.  **Modularization (>2k Line Files)**: We are actively reducing the size of monolithic files.
    *   Decompose large files (>2000 lines) into folders with a clear set of sub-components.
    *   Extract business logic into standalone services in `src/lib/` or `src/services/`.
    *   Modularize complex Astro layouts into smaller, reusable components.
4.  **Synthesize & Merge**: 
    *   Identify legacy code and duplicated functionalities before implementing something new.
    *   Favor merging and refactoring existing patterns over creating "alternative" parallel implementations.
5.  **Types Over Any**: Always ensure strict TypeScript typing. Avoid `any` at all costs, especially in core models or API responses.

## 📜 Rules of Engagement
1. **Context First:** Always check `docs/plans/2026-02-22-p0-execution.md` before starting new features.
2. **Persistence:** Never break the submission/persistence flow for `mcq` and `mcc` blocks and other ```eval``` blocks
3. **Validation:** Run existing tests or perform empirical manual verification before marking a task as complete.
