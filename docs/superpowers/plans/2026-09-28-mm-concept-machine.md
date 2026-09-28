# MishMash Concept Machine (tenant `mm`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch `mm.zztt.org`: forums with bibliography, threads with rhetorical moves, concepts with per-language credited definition versions, relations, graph, admin access (invites, rules, open-join), and a public export matching the MishMash Lab format.

**Architecture:** New tenant `mm` on the engine (whole host served, strict route allowlist). Space kind `commons` with its own roles. New `Concept*` tables; musiki's forum generalized (course XOR space) and reused for forums/threads/posts. Pure policy + domain cores (q-injected, fakeQuery-tested), thin routes, Astro pages with MishMash brand tokens and `t()` in `en`/`nb`.

**Tech Stack:** Astro 6 SSR, Postgres, Node 24 `node --test`, D3 (graph), musiki forum markdown (KaTeX, LilyPond, Seshat `@citekey`), Logto (`logto-mm`).

**Spec:** `docs/superpowers/specs/2026-09-28-mm-concept-machine-design.md`

## Global Constraints

- musiki and so behavior unchanged; musiki forum routes never return space rows (`spaceId IS NULL`); no musiki page reachable on mm (route sweep).
- Roles per space kind: `commons` = `admin|curator|member|guest`; `dissertation` unchanged. Grantable by invite/rule: all except `admin`.
- Policy matrix = spec §5 exactly. Anonymous users read everything public; writes require a member role.
- Definition editing option (a): concept author + curators edit; curators adopt posts → new version credited to the post author (`creditedUserId`), `fromPostId` set, post `adoptedAsVersionId` set.
- Languages: English source (required), Bokmål by hand (optional per concept), Nynorsk falls back to Bokmål in the UI; never silently machine-translate. UI dictionaries `en` + `nb`.
- Export contains no emails or user ids; display names only.
- Open-join switch off by default; unverified email always rejected.
- Pure modules: no astro/db imports; `.ts` imports; tests `*.test.mjs` registered in package.json.
- Never `git add -A`, never `git stash`, never read `.env`; remote shells fish → upload scripts; commits end with blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Branch: `feat/mm` in `/Users/zztt/projects/26-musiki/framework` (worktree recommended).

---

### Task 1: Migration

**Files:** `postgres-patches/migrations/20260929090000_mm_concepts_forum_spaces.sql`.
Before writing: read `docs/sql/forum-schema.sql` and query the live staging schema (read-only) for exact `ForumBoard/ForumThread/ForumPost` columns and constraints.
Contents (idempotent, guarded `DO $$` blocks): `Space.settings jsonb NOT NULL DEFAULT '{}'`; `Space.kind` CHECK adds `commons`; role CHECKs on `SpaceMember`, `SpaceInvite`, `SpaceAccessRule` replaced by the union (`author,supervisor,coordinator,reviewer,guest,admin,curator,member`; invites/rules exclude `author` and `admin`); `Concept`, `ConceptVersion` (with `lang`), `ConceptRelation` per spec §4 (+ `Concept.labelNb`); forum generalization per spec §4 with course XOR space CHECKs and `spaceId` indexes; `ForumPost.move` CHECK and `adoptedAsVersionId`.
- [ ] Write; commit `feat(db): mm concepts, commons spaces and forum generalization`. (Applied in Task 12.)

### Task 2: Roles per space kind + open-join access decision

**Files:** modify `src/lib/tenant/space-roles.ts` (`ROLES_BY_KIND`, `GRANTABLE_BY_KIND`, `isRoleForKind`, keep existing exports working for dissertation), `src/lib/tenant/access.ts` (`decideSpaceAccess` gains `openJoin?: boolean` and `spaceKind`; when no grant and `openJoin` and verified → grant `{ role: 'member', via: 'open-join' }`), `src/lib/tenant/access-db.ts` (load `Space.settings.openJoin` and kind; validate role for kind), invites/rules validation by kind in studio APIs; tests extend `access.test.mjs`.
- [ ] TDD: open-join off/on, unverified rejected, commons roles accepted, dissertation roles unchanged, `admin` never grantable; commit `feat(tenant): roles per space kind and open-join`.

### Task 3: Tenant `mm` config, routing, auth provider

**Files:** `src/lib/tenant/tenants.ts` (`mm` entry per spec §3; route families `mm`, `api:mm`, `api:public-mm`, `auth`), `src/lib/tenant/routes.ts` (family prefixes; **`/` must match exactly**, `/f`, `/c`, `/graph`, `/about`, `/join`, `/admin` as prefixes), `auth.config.ts` (provider `logto-mm` like `logto-so`, env `LOGTO_MM_CLIENT_ID/SECRET`), `astro.config.mjs` allowedHosts gets mm via TENANTS; tests: resolve/routes/auth-gate cases for mm, route sweep: every existing page unreachable on mm except the new mm pages (added in later tasks under `src/pages/mm/…` mounted at the mm routes — see Task 8 routing note).
- Routing note: mm pages live in `src/pages/mm/*` would be served at `/mm/*` by Astro. Instead implement the mm URLs with Astro rewrites in middleware: when `locals.tenant.id === 'mm'`, rewrite `/` → `/mm-app/`, `/f/…` → `/mm-app/f/…`, etc., and have the allowlist accept the public mm paths; `/mm-app/*` itself is **not** reachable directly on any host (404 in middleware if requested by URL). Document and test this mapping (pure function `mapMmPath(pathname): string | null`).
- [ ] TDD; commit `feat(tenant): mm tenant, routing map and logto-mm provider`.

### Task 4: Policy core

**Files:** `src/lib/mm/policy.ts` + `policy.test.mjs` (register `"src/lib/mm/*.test.mjs"`).
`can(role: CommonsRole | null, action: MmAction, ctx?: { isAuthor?: boolean; isOwnRelation?: boolean }): boolean` with actions: `read, vote, post, proposeConcept, editDefinition, adoptPost, changeStatus, moderate, createRelation, deleteRelation, manageForums, manageAccess`.
- [ ] TDD the full spec §5 table (anonymous = null); commit `feat(mm): permission policy`.

### Task 5: Concepts core

**Files:** `src/lib/mm/concepts-core.ts` (q-injected) + tests; `src/lib/mm/concepts.ts` (db-bound, transactions on one client like `course-order-core`).
Functions: `createConcept` (slug via slugify + uniqueness `-2`, v1 `lang='en'`, creates thread in the forum with `spaceId`, `boardId`), `getConcept(slug)` (current version per lang, history, relations, origin forum, thread id), `editDefinition({lang, definition, sources})`, `adoptPost({postId, lang, definition?})`, `setStatus`, `createRelation` (no self, unique), `deleteRelation`, `listConcepts({forumId?, status?})`, `graph({forumId?})`.
- [ ] TDD with fakeQuery incl. permission denials via policy, adopt credit/fromPostId, per-language current version, transaction rollback on failure; commit `feat(mm): concepts core`.

### Task 6: Forum generalization + mm forum core

**Files:** characterization tests for musiki forum routes first (`src/pages/api/forum/*` list/create semantics with fakeQuery where possible, or pure extraction of their SQL builders); add `spaceId IS NULL` to musiki forum list/detail queries; `src/lib/mm/forum-core.ts` (+ tests): `listForums`, `getForum(slug)`, `createForum/updateForum` (settings `seshatLibraryId`, `zoteroCollection`, `ownerEmail`), `listThreads(forumId)`, `createThread`, `listPosts(threadId)` (with author display names, move, votes, adopted marker), `createPost({move, parentPostId, body})`, `vote`, `moderatePost`. Render bodies with `renderForumMarkdown` (KaTeX, LilyPond, citations).
- [ ] TDD; musiki forum behavior unchanged (characterization green); commit `feat(mm): forum core on generalized musiki forum`.

### Task 7: Bibliography (Seshat)

**Files:** `src/lib/mm/bibliography.ts`, route `src/pages/api/mm/forums/[slug]/citations.ts` (search the forum's `seshatLibraryId` on behalf of `settings.ownerEmail` using `SESHAT_API_URL`/`SESHAT_INTEGRATION_TOKEN`, public-readable results limited to citation metadata), `.bib` import: first read `/Users/zztt/projects/packages/seshat` for an import/integration endpoint; if one exists, `POST /api/mm/forums/[slug]/bib` (curator) forwards the file; if not, **stop and report** (do not invent a Seshat API) — the fallback design (local `ForumReference` table) needs user approval.
- [ ] Commit `feat(mm): forum bibliography via Seshat`.

### Task 8: APIs

**Files:** `src/pages/api/mm/*` — forums (GET list/detail, POST/PATCH curator), threads/posts (GET public, POST member, PATCH moderate), concepts (GET public, POST member, PATCH definition/status, POST adopt), relations (POST/DELETE), graph (GET), admin (invites/rules/members/openJoin: reuse studio access code paths with kind-aware roles), `src/pages/api/public/mm/concepts.json.ts` (export per spec §8 incl. `_nb` fields). All wrapped like studio: tenant check, CSRF (`assertSameOriginJson`), `isUuid`, generic 500s, policy checks.
- [ ] Tests for export shape (no private fields) and wrappers; commit `feat(mm): mm APIs and public export`.

### Task 9: UI shell, i18n, brand

**Files:** `src/layouts/MmLayout.astro` (MishMash brand tokens copied from mishmash-web `site/assets/css/brand.css` into `src/styles/mm-brand.css` with attribution comment; wordmark from `site/assets/images/logo/`, shown as "built for the MishMash network"; header nav; language switch en/nb persisted in cookie `mm-lang`), `src/lib/i18n` add `mm.*` keys (en, es required by type; `nb` dictionary: add `nb.ts` typed against `en` for mm namespace — extend `Locale` with `'nb'` and `t()` fallback nb→en), `src/pages/mm-app/index.astro`, `about.astro`, `join.astro` (sign-in with `logto-mm`).
- [ ] Commit `feat(mm): layout, brand and bilingual shell`.

### Task 10: Forum, thread, concept, graph pages

**Files:** `src/pages/mm-app/f/[forum]/index.astro`, `f/[forum]/t/[thread].astro`, `c/[slug].astro`, `graph.astro`, client scripts `src/scripts/mm/*.ts` (composer with move selector and `@citekey` autocomplete against the forum citations route; adopt dialog for curators; relation picker; D3 graph reusing the Lab visual language with accessible list fallback).
- Missing Bokmål definition → visible note + link to English.
- [ ] Browser-check signed-out read, member post, curator adopt; commit `feat(mm): forum, thread, concept and graph pages`.

### Task 11: Admin page

**Files:** `src/pages/mm-app/admin.astro` (+ script): invites with commons roles, email/domain rules, members list with role changes, open-join switch, forums CRUD with bibliography link fields.
- [ ] Commit `feat(mm): admin (access, members, forums)`.

### Task 12: Rollout (ops — confirm with user before remote writes)

- [ ] Migration → `musiki_staging` twice → prod (backup first).
- [ ] Merge + deploy; Caddy block `mm.zztt.org` → `127.0.0.1:4321` (backup Caddyfile, validate, reload).
- [ ] Seed: `Space(tenantId 'mm', kind 'commons', slug 'mishmash', settings {openJoin:false})`, user as `admin`, forum `Stiegler` (curator: user; bibliography ids from the user).
- [ ] Verify: GitHub + email login; invite a test account; propose → discuss → adopt → relate → graph; export JSON; Bokmål switch; signed-out read; no musiki leakage (grep HTML).
- [ ] Point the fork's Lab page data at the export (manual copy first; GitHub Action proposal later).
