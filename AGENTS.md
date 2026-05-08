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

### 🤖 Agentic / Orf Pod
- [Agentic Docs Index](docs/agentic/README.md) — New branch for Orf planning, `/api/ai/run` contracts, Ollama services, RAG, LilyPond assistance, and guided microevaluations.
- [Orf Pod](docs/agentic/local-ai-pod.md) — Product/architecture vision for the transversal assistant in conference room and notes.
- [AI Service Contracts](docs/agentic/ai-service-contracts.md) — Proposed backend contracts for chat, RAG, LilyPond, micro-eval, and eval correction.
- [Local AI Roadmap](docs/agentic/local-ai-roadmap.md) — Phased implementation plan.

### 🎥 Live Events & Room
- [Live Events Protocol](docs/live-events-protocol.md) — Real-time event communication.
- [Room Mermaid Diagram](docs/room/roomMermaid.md) — Component relationship in the room stage.
- [Media Sync](docs/room/media-sync.md) — Playback synchronization details.

### 🛠️ Infrastructure & Ops
- [VPS Framework Runtime](docs/content-sync/vps-framework-runtime.md) — Production environment specs.
- [Database Management](docs/db/database-management.md) — Backup and persistence.
- [Ollama VPS Workflow](docs/ollama-vps-workflow.md) — Local AI integration.

## 🛡️ Plan de Estabilización Post-Merge (Abril 2026)

**Objetivo:** Resolver la lentitud crítica y las inestabilidades introducidas por la migración a Postgres local y el nuevo layout de Dockview.

### 📋 Acciones Inmediatas

#### Fase 1: Optimización de Infraestructura & DB
- [x] **Corrección de Conexión**: Corregido `DATABASE_URL` en `.env` para usar la IP interna del contenedor (`172.18.0.2:5432`) en lugar de `localhost:5433`.
- [x] **Pool de Conexiones**: Aumentado `max` en `src/lib/db/pool.ts` de 3 a 20.
- [ ] **Monitoreo**: Refinar el logging de `DB-POOL` para detectar saturación en tiempo real.
- [x] **Limpieza**: Removido `@supabase/supabase-js` de `[...slug].astro` y APIs de storage. `supabase/` renombrado a `postgres-patches/`.

#### Fase 2: Rendimiento SSR (Astro)
- [ ] **Optimizar `listRoomPresentationOptions`**: Cambiar iteración $O(N^2)$ por agrupamiento $O(N)$ y cachear resultados.
- [ ] **Middleware**: Revisar que `eval-sync` no bloquee el renderizado principal si hay fallos de red.

#### Fase 3: Estabilidad de UI (Dockview)
- [ ] **Idempotencia**: Asegurar que `bindElements` y la hidratación de pods pesados (LilyPond, Whiteboard) sean idempotentes.
- [ ] **Persistence**: Validar que el estado del `WorkspaceManager` se guarde correctamente en la nueva DB Postgres.

## 🗺️ Current Work (2026-05-08)

Recent: **SV/SA/RE pod redesign** — Sonic Visualizer + Analyzer overhaul, RS session architecture.

- [SV/SA redesign spec](docs/superpowers/specs/2026-05-07-sv-sa-redesign.md)
- [RE pod design](docs/superpowers/specs/2026-05-04-recursos-pod-design.md)
- [DB management](docs/db/database-management.md) — PostgreSQL on Hetzner, `postgres-patches/`

### 🎥 Room — Pod Docs
- [Pod Layout Architecture](docs/room/pod-layout.md) — Dockview pod system.
- [Room Architecture Diagram](docs/room/roomMermaid.md) — Full component map.
- [SA Pod](docs/SA-pod.md) — Sonic Analyzer pod design.

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
