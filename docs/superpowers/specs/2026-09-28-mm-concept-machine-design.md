# MishMash Concept Machine (tenant `mm`) — Design

**Date:** 2026-09-28
**Status:** Approved design, pending implementation plan
**Depends on:** Tenant layer (deployed), Studio workspace (deployed: spaces, invites, access rules, tree), musiki forum, Seshat
**Context:** MishMash Web Philosophy (static, no accounts, no tracking) → the machine runs at `mm.zztt.org`; mishmash.no integrates a static snapshot through its Lab (fork `zzigo/mishmash-web`, branch `lab/concept-machine`, page `/lab/concept-machine/` already built with seed data `site/_data/concept_machine.json`).

---

## 1. Goal

A discussion and concept machine for the MishMash network: **forums** (e.g. a Stiegler reading group) with an associated **bibliography**, **threads** whose posts carry a **rhetorical move**, and **concepts** that are proposed, discussed, defined in credited versions, related to each other and move from *neologism* to *assimilated*. First release: concepts first (propose, discuss, adopt, relate, graph), access by invitation/rules with an optional open-join switch, public reading without account, and an export consumed by the MishMash Lab.

## 2. Decisions

| Topic | Decision |
|---|---|
| Hosting | New tenant `mm` of the engine at `mm.zztt.org`; Caddy sends the whole host to the engine. |
| Auth | Logto app `mm` (provider id `logto-mm`); GitHub, Google and verified email via Logto's global sign-in experience. |
| Access | Same mechanism as so: `SpaceInvite`, `SpaceAccessRule` (email/domain), admin panel. Plus `openJoin` switch (off by default): verified email with no invite/rule joins as `member`. Reading is public. |
| Roles (space kind `commons`) | `admin` (all), `curator` (edit any definition, adopt posts, change status, moderate, relations, create forums), `member` (propose concepts, edit own concepts' definitions, post, relate), `guest` (read, vote). |
| Definition editing | Option (a): concept author + curators edit; everyone else contributes in the thread; a curator can **adopt** a post as a new definition version credited to the post's author. |
| Data approach | Option 1: new concept tables + musiki's forum generalized to spaces (course XOR space), as done for notes. |
| Forums | Generalized `ForumBoard` with `spaceId`; each forum has a bibliography (linked Zotero collection via Seshat and/or `.bib` import). |
| Writing | Reuse musiki forum markdown: `@citekey` citations (Seshat), KaTeX/MathJax, LilyPond blocks, image upload. |
| Graph | One concept graph per space, filterable by forum and status. |
| Export | `GET /api/public/mm/concepts.json` in the same shape as the Lab's `concept_machine.json` (incl. `label_nb`, `definition_nb`, `*_nb` label maps). |
| Languages | Aligned with MishMash (wiki "Nynorsk", `CONTENT_HANDOVER.yml`): **English is the source, Bokmål written by hand, Nynorsk generated** from Bokmål. UI in `en` and `nb` from day one (`t()` dictionaries; `nn` falls back to `nb` until a generated/reviewed set exists). Concepts carry per-language label and definition: English required, Bokmål optional-but-encouraged; a missing translation is shown as missing, never machine-filled silently. |

Out of scope (later phases): AI commenter (improve musiki's Orf; AI-labelled, human-accepted), emergence trace view, SRS cards from assimilated concepts, generated Nynorsk UI/concepts (Apertium, as mishmash-web does), proposing assimilated concepts into MishMash's `site/_data/glossary.yml` (term.en/nb/nn) by PR, a GitHub Action in MishMash's repo (proposed via PR later).

## 3. Tenant, routing, access

- `TENANTS.mm`: `hosts: ['mm.zztt.org']`, `locale: 'en'`, `brand: { name: 'MishMash Concept Machine', theme: 'mm' }`, `spaceKinds: ['commons']`, `authProviders: ['logto-mm']`, `homePath: '/'`, `routes`: new families `mm` (prefixes `/`, `/f`, `/c`, `/graph`, `/about`, `/join`, `/admin`), `api:mm` (`/api/mm`), `auth`, `api:public-mm` (`/api/public/mm`). The allowlist must match `/` exactly (not as a prefix of everything); the route sweep test enforces that no musiki page is reachable on mm.
- Caddy: `mm.zztt.org { encode; headers; reverse_proxy 127.0.0.1:4321 }`.
- Space: `Space(tenantId='mm', kind='commons', slug='mishmash', title='MishMash', lang='en', settings jsonb default '{}')` with `settings.openJoin boolean`. Migration adds `Space.settings`, extends `Space.kind` CHECK with `'commons'`, and replaces the role CHECKs on `SpaceMember`, `SpaceInvite`, `SpaceAccessRule` with the union of per-kind roles; per-kind validity is enforced in code.
- `space-roles.ts`: `ROLES_BY_KIND = { dissertation: [...existing], commons: ['admin','curator','member','guest'] }`, `GRANTABLE_BY_KIND` (commons: all except `admin`), `isRoleForKind(kind, role)`. so behavior unchanged.
- `signIn` (tenant mm): same `decideSpaceAccess` inputs plus `openJoin`: when no invite/rule grants and `openJoin` is on and email is verified → grant `member`. Unverified email always rejected.
- Admin panel `/admin`: invites, rules, member list with role changes, open-join switch, forum management. Admin/curator only as noted.

## 4. Data

```sql
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Space.kind CHECK: ('dissertation','course','commons'); role CHECKs: union of per-kind roles

CREATE TABLE "Concept" (
  id uuid PK, "spaceId" uuid NOT NULL → Space ON DELETE CASCADE, "forumId" uuid NULL → ForumBoard ON DELETE SET NULL,
  slug text NOT NULL, label text NOT NULL, "labelNb" text NULL,
  status text NOT NULL DEFAULT 'neologism' CHECK (status IN ('neologism','discussion','assimilated')),
  "threadId" uuid NULL → ForumThread ON DELETE SET NULL,
  "createdBy" uuid NOT NULL → User, "createdAt" timestamptz DEFAULT now(), "updatedAt" timestamptz DEFAULT now(),
  UNIQUE ("spaceId", slug)
);
CREATE TABLE "ConceptVersion" (
  id uuid PK, "conceptId" uuid NOT NULL → Concept ON DELETE CASCADE,
  lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en','nb','nn')),   -- one version history per language
  definition text NOT NULL, sources jsonb NOT NULL DEFAULT '[]',   -- [{ citekey?, url?, note? }]
  "editedBy" uuid NOT NULL → User, "creditedUserId" uuid NOT NULL → User,
  "fromPostId" uuid NULL → ForumPost ON DELETE SET NULL, "createdAt" timestamptz DEFAULT now()
);
CREATE TABLE "ConceptRelation" (
  id uuid PK, "spaceId" uuid NOT NULL → Space ON DELETE CASCADE,
  "sourceId" uuid NOT NULL → Concept ON DELETE CASCADE, "targetId" uuid NOT NULL → Concept ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('derives','combines','contrasts','reformulates','exemplifies')),
  "createdBy" uuid NOT NULL → User, "createdAt" timestamptz DEFAULT now(),
  UNIQUE ("sourceId","targetId",type), CHECK ("sourceId" <> "targetId")
);
-- musiki forum generalization (additive)
ALTER TABLE "ForumBoard"  ALTER COLUMN "courseId" DROP NOT NULL; ADD "spaceId" uuid NULL → Space; ADD "settings" jsonb DEFAULT '{}';  -- settings.zoteroCollection, settings.seshatLibraryId, settings.ownerEmail
ALTER TABLE "ForumThread" ALTER COLUMN "courseId" DROP NOT NULL; ALTER COLUMN "lessonSlug" DROP NOT NULL; ADD "spaceId" uuid NULL → Space; ADD "boardId" uuid NULL → ForumBoard;
ALTER TABLE "ForumPost"   ADD "move" text NULL CHECK (move IN ('comment','proposes','contrasts','combines','exemplifies','problematises','synthesises')); ADD "adoptedAsVersionId" uuid NULL → ConceptVersion ON DELETE SET NULL;
-- course XOR space on ForumBoard and ForumThread; indexes on spaceId
```
(Exact column names of the existing forum tables are verified against `docs/sql/forum-schema.sql` and the live schema before writing the migration; all changes guarded for idempotency.)

- Current definition per language = latest `ConceptVersion` for that `lang` by `createdAt`; the English one is required (v1 at creation), Bokmål versions are added by author/curators or adopted from posts written in Bokmål.
- Creating a concept creates its v1 (`creditedUserId = editedBy = author`) and its thread (`ForumThread` with `spaceId`, `boardId = forumId`, title = label).
- Adopting post P (curator) creates `ConceptVersion(definition = P.body or curator-edited text, creditedUserId = P.author, editedBy = curator, fromPostId = P.id)` and sets `P.adoptedAsVersionId`.
- musiki forum routes add `spaceId IS NULL` filters; mm routes are new and scope by space.

## 5. Permissions (pure, tested: `src/lib/mm/policy.ts`)

| Action | guest | member | curator | admin | anonymous |
|---|---|---|---|---|---|
| read forums, threads, concepts, graph | ✔ | ✔ | ✔ | ✔ | ✔ |
| vote | ✔ | ✔ | ✔ | ✔ | — |
| post / reply (with move) | — | ✔ | ✔ | ✔ | — |
| propose concept | — | ✔ | ✔ | ✔ | — |
| edit definition | — | own concepts | ✔ | ✔ | — |
| adopt post as version, change status, moderate posts | — | — | ✔ | ✔ | — |
| create/delete relation | — | ✔ create; delete own | ✔ | ✔ | — |
| create/edit forums, link bibliography | — | — | ✔ | ✔ | — |
| invites, rules, roles, open-join | — | — | — | ✔ | — |

## 6. UI (tenant mm, English, MishMash brand tokens)

- Layout `MmLayout.astro`: MishMash visual identity (brand tokens copied from `mishmash-web/site/assets/css/brand.css`, wordmark with attribution), header: Forums · Concepts · Graph · About · Sign in / avatar.
- `/` forums list + recent activity + small graph; `/f/<forum>` description, bibliography panel (search, links to Zotero), threads, concepts born here, actions; `/f/<forum>/t/<id>` thread; `/c/<slug>` concept (current definition with credit, history, relations, origin forum, thread, adopt/status actions for curators); `/graph` full graph (D3, same visual language as the Lab page, filters by forum/status; accessible list fallback); `/admin` access + forums.
- Composer: markdown with `@citekey` autocomplete from the forum bibliography, KaTeX/MathJax, LilyPond (musiki `renderForumMarkdown` + Seshat citations), move selector.
- Everything via `t()` with `en` and `nb` dictionaries (language switch in the header, persisted per user; `nn` → `nb` fallback); nothing mentions musiki.
- Concept pages show the definition in the reader's language with a visible "not yet available in Bokmål" note when missing, and link to the other language.

## 7. Bibliography

- Per forum: `settings.zoteroCollection` (a Seshat-synced Zotero collection) and/or a `.bib` upload imported into a Seshat library bound to the forum.
- `@citekey` resolves through Seshat's citations API (`src/pages/api/seshat/citations.ts`, `remark-seshat-citations`) scoped to the forum's library; rendered citation + reference list; each reference links to its Zotero item.
- Exact Seshat endpoints and library model are verified during planning (read `packages/seshat` and the existing musiki integration).

## 8. Export

- `GET /api/public/mm/concepts.json` (no auth, cacheable): `{ snapshot, note, statuses, relation_types, concepts:[{ id: slug, label, status, definition, authors:[display names of credited users], forum }], relations:[{ source, target, type }] }` — same shape as the Lab's `concept_machine.json` plus `forum`. No emails or user ids.
- Later: a GitHub Action in the MishMash repo (nightly, like NVA sync) fetches it into `site/_data/concept_machine.json` (proposed by PR).

## 9. Testing

- Pure: language fallback (nn→nb→en for UI; per-concept missing-translation state, never silent machine fill); policy matrix (§5); role-per-kind validation; open-join decision; slug generation/uniqueness; export shape (no private fields); adopt-post version construction.
- Route sweep: no musiki route reachable on mm; `/` exact match.
- Forum generalization: characterization tests for musiki forum routes before change; musiki lists never include space threads.
- Staging: migration twice, XOR constraints, create forum/concept/thread/adopt flow via API.

## 10. Rollout

1. Migration → staging → prod (backup).
2. Engine deploy; Caddy `mm.zztt.org`; seed space `mishmash` with the user as `admin`; create forum "Stiegler".
3. Verify login (GitHub, email), invites, propose/discuss/adopt/relate, graph, export; then point the fork's Lab page at the export.
