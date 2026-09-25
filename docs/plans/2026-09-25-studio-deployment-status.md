# SO Studio release — 2026-09-25

Implementation: `2de5157`, on top of the earlier Tasks 1–7 commits.

## Delivered

- Tenant-aware space notes and folders, inherited visibility, manual ordering API.
- Shared tree renderer used in SO Studio, including create, rename, delete, visibility, keyboard-operable move buttons and drag movement.
- Studio editor mounts Musiki's existing editor, annotation/version controls, preview and export paths. English tracer labels and language-aware analysis are forwarded correctly.
- Author overview bootstraps GTX/Output; root notes remain private by default. Structure shows counts by effective visibility.
- Reviewer committee access can read frozen versions, but cannot retrieve live annotations/traces or the live note body. Course version access remains editor-only.
- Annotation updates validate target parent identity; deletes recheck tenant-aware access. Database write failures cannot appear as successful saves.

## Evidence

- 239 Node tests pass; production Astro build succeeds.
- Focused TypeScript diagnostics for changed writing/Studio/API modules clear. Repository-wide legacy diagnostics remain.
- Migration applied twice to `musiki_staging`; XOR rejection verified with a rolled-back test transaction.
- Isolated staging server verified CRUD, saved-body reload, visibility matrix, supervisor comments, coordinator filtering, reviewer version reads and mutation denial, cross-tenant denial, reorder and anonymous redirect.
- Browser verified the editor, autosave/reload, English tracer, comments/history controls, and export menu.
- Production Sign in reaches the configured SO Logto application. A complete real-account OAuth callback was not exercised by the agent.
- Public site built and browser-checked at desktop/mobile widths and both themes. NMH/MishMash assets switch with the theme. Public site deployed with previous dist retained.
- Production DB backed up before the additive migration: `/home/zz/backups/musiki26-pre-studio-20260925154117.dump`.

## Remaining from the broader normalization plan

Task 11 (replace Musiki's existing DB-notes sidebar with the shared renderer) is not part of this SO-first release. Its existing sidebar and sharing UI remain in use. Tree phase 2, folder reparenting in the UI, Studio Dockview, and localized AI suggestions remain later work. Media upload wiring is present; external storage upload has not been exercised during this release.

Public content provenance is recorded separately in so-web `docs/content-provenance-2026-09-25.md`. The source vault is not bulk-published or modified. The public research pages are edited summaries; the private manuscript has not been imported into database notes.
