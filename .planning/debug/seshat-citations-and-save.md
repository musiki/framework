---
status: verification-needed
trigger: "Seshat citation autocomplete does not appear in 90 NOTAS or course-note editing; /api/notes/save returns 400."
created: 2026-07-01
updated: 2026-07-01
---

# Symptoms

- Expected: typing `@` in either note editor opens Seshat reference search and selection inserts a Pandoc citation.
- Actual: no searchbox appears.
- Error: repeated `POST /api/notes/save 400`; browser-extension message ports also close without a response.
- Timeline: first production test after the citation autocomplete deployment.
- Reproduction: open 90 NOTAS or a course note, type `@`, edit/close the note.

# Current Focus

- hypothesis: Autocomplete returned no options because Musiki's Authentik email hashed to a different Seshat owner than the curated catalog. Save 400 is separate and needs one instrumented retry.
- test: Pin the trusted integration to the real Seshat owner key and query it; add content-free save rejection logging and client error surfacing.
- expecting: `@` now shows five references; any subsequent save 400 records its courseId, slug and rejection reason.
- next_action: User hard-refreshes and retries autocomplete and the failing save once.

# Evidence

- 2026-07-01: Musiki session email hashed to owner `1f03...`, while all five Seshat references belong to `b08c...`; authenticated citation search returned zero items.
- 2026-07-01: After fixed-owner configuration, the production Seshat integration returns five items for the same trusted token regardless of consumer email claim.
- 2026-07-01: All 37 registered course notes across s123/i1/i2 resolve successfully through `getCourseNote`; no general filesystem lookup failure found.
- 2026-07-01: Browser `content.js` message-port error originates from an extension context and is independent of Musiki APIs.

# Eliminated


# Resolution

- root_cause: Autocomplete catalog identity mismatch fixed. Exact save rejection awaits a single post-instrumentation reproduction.
- fix: Seshat integration pinned to the curated catalog owner; save endpoint and autosave now expose safe diagnostics without note content.
- verification: Seshat tests/typecheck/build pass; production endpoint returns five items; Musiki 76 tests/build pass; both PM2 services online.
- files_changed: Seshat integration auth/config/docs; Musiki notes save diagnostics and persistence status.
