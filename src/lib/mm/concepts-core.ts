// mm concepts core: create/get/edit per-language definitions, adopt a thread
// post as a new credited version, status, relations, listing and graph.
// Spec §4 (data), §5 (policy), §2/§4 (languages, adoption) of
// docs/superpowers/specs/2026-09-28-mm-concept-machine-design.md.
//
// Pure module: no astro/db imports. Every function takes `q: QueryFn` first so
// it runs under fakeQuery in tests; `concepts.ts` binds `q` to the pool (reads)
// or to one pooled client (mutations, which run in a single transaction).
//
// Users: Concept*.createdBy / editedBy / creditedUserId are nullable (ON DELETE
// SET NULL) — a NULL id is a deleted user and reads return `{ name: null,
// deleted: true }`. Reads never expose emails; display names only, and the
// graph exposes no user fields at all.
//
// Languages: English is the source (v1 at creation, required); Bokmål/Nynorsk
// versions exist only when written or adopted by a person. Nothing here ever
// fills a missing language from another one.

import { can, type MmAction, type MmPolicyCtx } from './policy.ts';
import { COMMONS_ROLES, isUuid, type CommonsRole } from '../tenant/space-roles.ts';
import { slugify } from '../site/frontmatter.ts';
import { publicName } from './view.ts';

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>;

export const CONCEPT_LANGS = ['en', 'nb', 'nn'] as const;
export type ConceptLang = (typeof CONCEPT_LANGS)[number];
export const CONCEPT_STATUSES = ['neologism', 'discussion', 'assimilated'] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];
export const RELATION_TYPES = ['derives', 'combines', 'contrasts', 'reformulates', 'exemplifies'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const isConceptLang = (v: unknown): v is ConceptLang =>
  typeof v === 'string' && (CONCEPT_LANGS as readonly string[]).includes(v);
export const isConceptStatus = (v: unknown): v is ConceptStatus =>
  typeof v === 'string' && (CONCEPT_STATUSES as readonly string[]).includes(v);
export const isRelationType = (v: unknown): v is RelationType =>
  typeof v === 'string' && (RELATION_TYPES as readonly string[]).includes(v);

export class ConceptError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ConceptError';
    this.status = status;
  }
}

export type Source = { citekey?: string; url?: string; note?: string };
export type UserRef = { name: string | null; deleted: boolean };

const MAX_LABEL = 200;
const MAX_DEFINITION = 20000;
const MAX_SOURCES = 50;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function toThrowable(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const err = new ConceptError(500, message || 'database error');
  if (typeof error === 'object' && error !== null && 'code' in error) {
    (err as any).code = (error as { code: unknown }).code;
  }
  return err;
}

/** Runs a statement and throws on a reported error (never "zero rows" on failure). */
async function run(q: QueryFn, text: string, params: unknown[] = []): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw toThrowable(error);
  return data ?? [];
}

/**
 * Runs `fn` inside BEGIN/COMMIT on `q` (which must be bound to one client),
 * issuing ROLLBACK and rethrowing on any failure.
 */
export async function withTransaction<T>(q: QueryFn, fn: () => Promise<T>): Promise<T> {
  await run(q, 'BEGIN');
  try {
    const result = await fn();
    await run(q, 'COMMIT');
    return result;
  } catch (err) {
    try {
      await run(q, 'ROLLBACK');
    } catch (rollbackErr) {
      console.error('[mm/concepts-core] ROLLBACK failed after error:', rollbackErr, 'original error:', err);
    }
    throw err;
  }
}

/**
 * Whether a pooled client that ran a failed core call must be destroyed rather
 * than returned to the pool: only expected domain errors (ConceptError,
 * ForumError or MmApiError < 500,
 * thrown before BEGIN or after a successful ROLLBACK) leave it clean.
 */
export function shouldDestroyClient(err: unknown, rollbackFailed: boolean): boolean {
  if (rollbackFailed) return true;
  // Name check (not instanceof) so forum-core's ForumError and api-core's
  // MmApiError count too without a circular import.
  const name = (err as { name?: unknown })?.name;
  const status = Number((err as { status?: unknown })?.status);
  const domain = err instanceof ConceptError || name === 'ForumError' || name === 'MmApiError';
  return !(domain && err instanceof Error && Number.isFinite(status) && status < 500);
}

const isUniqueViolation = (err: unknown) => (err as { code?: unknown })?.code === '23505';

/** Public user reference: display name only (never one that looks like an e-mail), or deleted. */
const userRef = (id: string | null | undefined, name: string | null | undefined): UserRef =>
  id ? { name: publicName(name), deleted: false } : { name: null, deleted: true };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanLabel(raw: unknown, field = 'label'): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  if (!label) throw new ConceptError(400, `${field} required`);
  if (label.length > MAX_LABEL) throw new ConceptError(400, `${field} too long`);
  return label;
}

function cleanOptionalLabel(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return cleanLabel(raw, field);
}

function cleanDefinition(raw: unknown): string {
  const def = typeof raw === 'string' ? raw.trim() : '';
  if (!def) throw new ConceptError(400, 'definition required');
  if (def.length > MAX_DEFINITION) throw new ConceptError(400, 'definition too long');
  return def;
}

export function cleanSources(raw: unknown): Source[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConceptError(400, 'sources must be an array');
  if (raw.length > MAX_SOURCES) throw new ConceptError(400, 'too many sources');
  const out: Source[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new ConceptError(400, 'invalid source');
    const s: Source = {};
    for (const key of ['citekey', 'url', 'note'] as const) {
      const v = (item as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) s[key] = v.trim();
    }
    if (Object.keys(s).length) out.push(s);
  }
  return out;
}

function requireUuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isUuid(value)) throw new ConceptError(404, `${what} not found`);
  return value;
}

/** Base slug for a label: site slugify, but never the site's `'page'` fallback. */
export function conceptBaseSlug(label: string): string {
  const s = slugify(label);
  return s === 'page' && !/page/i.test(label) ? 'concept' : s;
}

/** First free slug among `base`, `base-2`, `base-3`, … given the taken ones. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Roles / permission
// ---------------------------------------------------------------------------

const isCommonsRole = (v: unknown): v is CommonsRole =>
  typeof v === 'string' && (COMMONS_ROLES as readonly string[]).includes(v);

export async function getCommonsRole(q: QueryFn, spaceId: string, userId: string | null): Promise<CommonsRole | null> {
  if (!userId) return null;
  const rows = await run(
    q,
    // Only commons-space memberships count: a role in a dissertation (or any
    // other kind of) space must never authorize an mm action.
    `SELECT m."role" FROM "SpaceMember" m
     JOIN "Space" s ON s.id = m."spaceId" AND s.kind = 'commons'
     WHERE m."spaceId" = $1::uuid AND m."userId" = $2::uuid LIMIT 1`,
    [spaceId, userId],
  );
  const role = rows[0]?.role;
  return isCommonsRole(role) ? role : null;
}

async function authorize(
  q: QueryFn,
  spaceId: string,
  actorUserId: string | null,
  action: MmAction,
  ctx: (role: CommonsRole | null) => MmPolicyCtx = () => ({}),
): Promise<CommonsRole> {
  if (!actorUserId) throw new ConceptError(401, 'sign in required');
  const role = await getCommonsRole(q, spaceId, actorUserId);
  if (!role || !can(role, action, ctx(role))) throw new ConceptError(403, `not allowed: ${action}`);
  return role;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

type ConceptRow = {
  id: string;
  spaceId: string;
  forumId: string | null;
  slug: string;
  label: string;
  labelNb: string | null;
  status: ConceptStatus;
  threadId: string | null;
  createdBy: string | null;
};

async function loadConceptById(q: QueryFn, conceptId: unknown, forUpdate = false): Promise<ConceptRow> {
  const id = requireUuid(conceptId, 'concept');
  const rows = await run(
    q,
    `SELECT id, "spaceId", "forumId", slug, label, "labelNb", status, "threadId", "createdBy"
     FROM "Concept" WHERE id = $1::uuid LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  if (!rows.length) throw new ConceptError(404, 'concept not found');
  return rows[0];
}

async function touchConcept(q: QueryFn, conceptId: string) {
  await run(q, `UPDATE "Concept" SET "updatedAt" = now() WHERE id = $1::uuid`, [conceptId]);
}

async function insertVersion(
  q: QueryFn,
  v: {
    conceptId: string;
    lang: ConceptLang;
    definition: string;
    sources: Source[];
    editedBy: string;
    creditedUserId: string | null;
    fromPostId?: string | null;
  },
): Promise<{ id: string; createdAt: string }> {
  const rows = await run(
    q,
    `INSERT INTO "ConceptVersion" ("conceptId", lang, definition, sources, "editedBy", "creditedUserId", "fromPostId")
     VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid, $6::uuid, $7::uuid)
     RETURNING id, "createdAt"`,
    [v.conceptId, v.lang, v.definition, JSON.stringify(v.sources), v.editedBy, v.creditedUserId, v.fromPostId ?? null],
  );
  if (!rows.length) throw new ConceptError(500, 'version insert returned nothing');
  return rows[0];
}

// ---------------------------------------------------------------------------
// createConcept
// ---------------------------------------------------------------------------

/**
 * Proposes a concept in `forumId` (a forum of `spaceId`): unique slug, the
 * concept's discussion thread (ForumThread with spaceId + boardId, no course),
 * Concepts belong to the GROUP: when `forumId` is a channel, the discussion
 * thread lives in the channel but Concept.forumId is the channel's group.
 * and v1 in English credited to the author. An optional hand-written Bokmål
 * definition becomes the nb v1. One transaction; `q` must be one client.
 */
export async function createConcept(
  q: QueryFn,
  input: {
    spaceId: string;
    forumId: string;
    actorUserId: string | null;
    label: unknown;
    labelNb?: unknown;
    definition: unknown;
    definitionNb?: unknown;
    sources?: unknown;
  },
): Promise<{ id: string; slug: string; threadId: string; versionId: string }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'proposeConcept');
  const actor = input.actorUserId as string;
  const label = cleanLabel(input.label);
  const labelNb = cleanOptionalLabel(input.labelNb, 'labelNb');
  const definition = cleanDefinition(input.definition);
  const definitionNb =
    input.definitionNb === undefined || input.definitionNb === null || String(input.definitionNb).trim() === ''
      ? null
      : cleanDefinition(input.definitionNb);
  const sources = cleanSources(input.sources);
  const forumId = requireUuid(input.forumId, 'forum');

  const forum = await run(
    q,
    `SELECT b.id, b."parentId" FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
     WHERE b.id = $1::uuid AND b."spaceId" = $2::uuid AND b."isArchived" = false AND pb."isArchived" IS NOT TRUE LIMIT 1`,
    [forumId, spaceId],
  );
  if (!forum.length) throw new ConceptError(404, 'forum not found');
  const groupId: string = forum[0].parentId ?? forumId;

  const base = conceptBaseSlug(label);

  try {
    return await withTransaction(q, async () => {
      // Serialize slug allocation per space for the transaction's lifetime.
      await run(q, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`mm-concept-slug:${spaceId}`]);
      const taken = await run(
        q,
        `SELECT slug FROM "Concept" WHERE "spaceId" = $1::uuid AND (slug = $2 OR slug LIKE $3)`,
        [spaceId, base, `${base}-%`],
      );
      const slug = uniqueSlug(base, taken.map((r: any) => r.slug));

      const thread = await run(
        q,
        `INSERT INTO "ForumThread" ("spaceId", "boardId", title, "createdByUserId")
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid) RETURNING id`,
        [spaceId, forumId, label, actor],
      );
      const threadId = thread[0]?.id;
      if (!threadId) throw new ConceptError(500, 'thread insert returned nothing');

      const concept = await run(
        q,
        `INSERT INTO "Concept" ("spaceId", "forumId", slug, label, "labelNb", "threadId", "createdBy")
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid) RETURNING id`,
        [spaceId, groupId, slug, label, labelNb, threadId, actor],
      );
      const id = concept[0]?.id;
      if (!id) throw new ConceptError(500, 'concept insert returned nothing');

      const v1 = await insertVersion(q, {
        conceptId: id, lang: 'en', definition, sources, editedBy: actor, creditedUserId: actor,
      });
      if (definitionNb) {
        await insertVersion(q, {
          conceptId: id, lang: 'nb', definition: definitionNb, sources, editedBy: actor, creditedUserId: actor,
        });
      }
      return { id, slug, threadId, versionId: v1.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConceptError(409, 'concept slug already exists');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getConcept
// ---------------------------------------------------------------------------

export type ConceptVersionView = {
  id: string;
  lang: ConceptLang;
  definition: string;
  sources: Source[];
  editedBy: UserRef;
  credited: UserRef;
  fromPostId: string | null;
  createdAt: string;
};

export type ConceptRelationView = {
  id: string;
  type: RelationType;
  direction: 'out' | 'in';
  other: { id: string; slug: string; label: string; labelNb: string | null };
  createdBy: UserRef;
  /** Whether `viewerUserId` created it (for "delete own" in the UI); never the id itself. */
  own: boolean;
};

export type ConceptView = {
  id: string;
  spaceId: string;
  slug: string;
  label: string;
  labelNb: string | null;
  status: ConceptStatus;
  threadId: string | null;
  /** The group the concept belongs to. */
  forum: { id: string; slug: string; title: string } | null;
  /**
   * Where its discussion thread lives: the thread's group slug and, when the
   * thread is in a channel, the channel (for /f/<group>/<channel>/t/<id>).
   * Null when there is no thread (or it lost its board).
   */
  origin: { groupSlug: string; channel: { slug: string; title: string } | null } | null;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  /** Latest version per language that exists; a missing language is absent (never filled). */
  current: Partial<Record<ConceptLang, ConceptVersionView>>;
  /** All versions, newest first. */
  history: ConceptVersionView[];
  relations: ConceptRelationView[];
};

/** Picks the latest version per language (input need not be sorted). */
export function currentByLang(versions: ConceptVersionView[]): Partial<Record<ConceptLang, ConceptVersionView>> {
  const out: Partial<Record<ConceptLang, ConceptVersionView>> = {};
  for (const v of versions) {
    const cur = out[v.lang];
    if (!cur || new Date(v.createdAt).getTime() > new Date(cur.createdAt).getTime()) out[v.lang] = v;
  }
  return out;
}

function parseSources(raw: unknown): Source[] {
  if (Array.isArray(raw)) return raw as Source[];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getConcept(
  q: QueryFn,
  { spaceId, slug, viewerUserId = null }: { spaceId: string; slug: string; viewerUserId?: string | null },
): Promise<ConceptView | null> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId) || typeof slug !== 'string' || !slug) return null;
  const rows = await run(
    q,
    `SELECT c.id, c."spaceId", c.slug, c.label, c."labelNb", c.status, c."threadId", c."createdBy",
            c."createdAt", c."updatedAt", u.name AS "createdByName",
            f.id AS "forumId", f.slug AS "forumSlug", f.title AS "forumTitle",
            tb.slug AS "threadBoardSlug", tb.title AS "threadBoardTitle", tpb.slug AS "threadGroupSlug"
     FROM "Concept" c
     LEFT JOIN "User" u ON u.id = c."createdBy"
     LEFT JOIN "ForumBoard" f ON f.id = c."forumId"
     LEFT JOIN "ForumThread" ct ON ct.id = c."threadId" AND ct."spaceId" = c."spaceId"
     LEFT JOIN "ForumBoard" tb ON tb.id = ct."boardId"
     LEFT JOIN "ForumBoard" tpb ON tpb.id = tb."parentId"
     WHERE c."spaceId" = $1::uuid AND c.slug = $2
     LIMIT 1`,
    [spaceId, slug],
  );
  const c = rows[0];
  if (!c) return null;

  const versionRows = await run(
    q,
    `SELECT v.id, v.lang, v.definition, v.sources, v."editedBy", v."creditedUserId", v."fromPostId", v."createdAt",
            ue.name AS "editedByName", uc.name AS "creditedName"
     FROM "ConceptVersion" v
     LEFT JOIN "User" ue ON ue.id = v."editedBy"
     LEFT JOIN "User" uc ON uc.id = v."creditedUserId"
     WHERE v."conceptId" = $1::uuid
     ORDER BY v."createdAt" DESC, v.id DESC`,
    [c.id],
  );
  const history: ConceptVersionView[] = versionRows.map((v: any) => ({
    id: v.id,
    lang: v.lang,
    definition: v.definition,
    sources: parseSources(v.sources),
    editedBy: userRef(v.editedBy, v.editedByName),
    credited: userRef(v.creditedUserId, v.creditedName),
    fromPostId: v.fromPostId ?? null,
    createdAt: v.createdAt,
  }));

  const relRows = await run(
    q,
    `SELECT r.id, r.type, r."sourceId", r."targetId", r."createdBy", ur.name AS "createdByName",
            o.id AS "otherId", o.slug AS "otherSlug", o.label AS "otherLabel", o."labelNb" AS "otherLabelNb"
     FROM "ConceptRelation" r
     JOIN "Concept" o ON o.id = CASE WHEN r."sourceId" = $1::uuid THEN r."targetId" ELSE r."sourceId" END
     LEFT JOIN "User" ur ON ur.id = r."createdBy"
     WHERE r."sourceId" = $1::uuid OR r."targetId" = $1::uuid
     ORDER BY r."createdAt" ASC, r.id ASC`,
    [c.id],
  );
  const relations: ConceptRelationView[] = relRows.map((r: any) => ({
    id: r.id,
    type: r.type,
    direction: r.sourceId === c.id ? 'out' : 'in',
    other: { id: r.otherId, slug: r.otherSlug, label: r.otherLabel, labelNb: r.otherLabelNb ?? null },
    createdBy: userRef(r.createdBy, r.createdByName),
    own: !!viewerUserId && r.createdBy === viewerUserId,
  }));

  return {
    id: c.id,
    spaceId: c.spaceId,
    slug: c.slug,
    label: c.label,
    labelNb: c.labelNb ?? null,
    status: c.status,
    threadId: c.threadId ?? null,
    forum: c.forumId ? { id: c.forumId, slug: c.forumSlug, title: c.forumTitle } : null,
    origin: !c.threadId || !c.threadBoardSlug
      ? null
      : c.threadGroupSlug
        ? { groupSlug: c.threadGroupSlug, channel: { slug: c.threadBoardSlug, title: c.threadBoardTitle } }
        : { groupSlug: c.threadBoardSlug, channel: null },
    createdBy: userRef(c.createdBy, c.createdByName),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    current: currentByLang(history),
    history,
    relations,
  };
}

// ---------------------------------------------------------------------------
// editDefinition / adoptPost / setStatus / labels
// ---------------------------------------------------------------------------

/** New version in `lang` by the actor (concept author or curator/admin), credited to the actor. */
export async function editDefinition(
  q: QueryFn,
  input: { conceptId: string; actorUserId: string | null; lang: unknown; definition: unknown; sources?: unknown },
): Promise<{ versionId: string }> {
  const concept = await loadConceptById(q, input.conceptId);
  await authorize(q, concept.spaceId, input.actorUserId, 'editDefinition', () => ({
    isAuthor: !!concept.createdBy && concept.createdBy === input.actorUserId,
  }));
  if (!isConceptLang(input.lang)) throw new ConceptError(400, 'invalid lang');
  const lang = input.lang;
  const definition = cleanDefinition(input.definition);
  const sources = cleanSources(input.sources);
  const actor = input.actorUserId as string;

  return withTransaction(q, async () => {
    const v = await insertVersion(q, {
      conceptId: concept.id, lang, definition, sources, editedBy: actor, creditedUserId: actor,
    });
    await touchConcept(q, concept.id);
    return { versionId: v.id };
  });
}

/**
 * Curator adopts forum post `postId` as a new `lang` version of the concept:
 * definition = the curator's edited text or the post body; credited to the
 * post's author, edited by the curator, `fromPostId` set; the post's
 * `adoptedAsVersionId` points at the new version. One transaction.
 */
export async function adoptPost(
  q: QueryFn,
  input: {
    conceptId: string;
    postId: string;
    actorUserId: string | null;
    lang: unknown;
    definition?: unknown;
    sources?: unknown;
  },
): Promise<{ versionId: string; credited: UserRef }> {
  const concept = await loadConceptById(q, input.conceptId);
  await authorize(q, concept.spaceId, input.actorUserId, 'adoptPost');
  if (!isConceptLang(input.lang)) throw new ConceptError(400, 'invalid lang');
  const lang = input.lang;
  const postId = requireUuid(input.postId, 'post');
  const sources = cleanSources(input.sources);
  const actor = input.actorUserId as string;
  const override =
    input.definition === undefined || input.definition === null || String(input.definition).trim() === ''
      ? null
      : cleanDefinition(input.definition);

  return withTransaction(q, async () => {
    // Lock the concept, then the post (fixed order), so concurrent adoptions
    // serialize and a post cannot be adopted twice.
    await loadConceptById(q, concept.id, true);
    const posts = await run(
      q,
      `SELECT p.id, p."authorUserId", p.body, p.status, p."adoptedAsVersionId",
              t."spaceId", t."isLocked", t."archivedAt", u.name AS "authorName"
       FROM "ForumPost" p
       JOIN "ForumThread" t ON t.id = p."threadId"
       LEFT JOIN "User" u ON u.id = p."authorUserId"
       WHERE p.id = $1::uuid
       FOR UPDATE OF p`,
      [postId],
    );
    const post = posts[0];
    if (!post || post.spaceId !== concept.spaceId) throw new ConceptError(404, 'post not found');
    if (post.isLocked || post.archivedAt) throw new ConceptError(409, 'thread is locked or archived');
    if (post.status !== 'published') throw new ConceptError(409, 'post is not published');
    if (post.adoptedAsVersionId) throw new ConceptError(409, 'post already adopted');

    const definition = override ?? cleanDefinition(post.body);
    const creditedUserId: string | null = post.authorUserId ?? null;
    const v = await insertVersion(q, {
      conceptId: concept.id, lang, definition, sources, editedBy: actor, creditedUserId, fromPostId: post.id,
    });
    const updated = await run(
      q,
      `UPDATE "ForumPost" SET "adoptedAsVersionId" = $1::uuid WHERE id = $2::uuid RETURNING id`,
      [v.id, post.id],
    );
    if (!updated.length) throw new ConceptError(500, 'post update matched nothing');
    await touchConcept(q, concept.id);
    return { versionId: v.id, credited: userRef(creditedUserId, post.authorName) };
  });
}

export async function setStatus(
  q: QueryFn,
  input: { conceptId: string; actorUserId: string | null; status: unknown },
): Promise<{ status: ConceptStatus }> {
  const concept = await loadConceptById(q, input.conceptId);
  await authorize(q, concept.spaceId, input.actorUserId, 'changeStatus');
  if (!isConceptStatus(input.status)) throw new ConceptError(400, 'invalid status');
  const rows = await run(
    q,
    `UPDATE "Concept" SET status = $1 WHERE id = $2::uuid RETURNING status`,
    [input.status, concept.id],
  );
  if (!rows.length) throw new ConceptError(404, 'concept not found');
  return { status: rows[0].status };
}

/** Labels (en required, nb optional) follow the same rule as definitions; the thread title follows the English label. One transaction. */
export async function setLabels(
  q: QueryFn,
  input: { conceptId: string; actorUserId: string | null; label?: unknown; labelNb?: unknown },
): Promise<{ label: string; labelNb: string | null }> {
  const concept = await loadConceptById(q, input.conceptId);
  await authorize(q, concept.spaceId, input.actorUserId, 'editDefinition', () => ({
    isAuthor: !!concept.createdBy && concept.createdBy === input.actorUserId,
  }));
  const label = input.label === undefined ? concept.label : cleanLabel(input.label);
  const labelNb = input.labelNb === undefined ? concept.labelNb : cleanOptionalLabel(input.labelNb, 'labelNb');
  // The concept's discussion thread is titled by its English label; keep them in step.
  return withTransaction(q, async () => {
    await run(q, `UPDATE "Concept" SET label = $1, "labelNb" = $2 WHERE id = $3::uuid`, [label, labelNb, concept.id]);
    if (label !== concept.label && concept.threadId) {
      await run(q, `UPDATE "ForumThread" SET title = $1 WHERE id = $2::uuid AND "spaceId" = $3::uuid`, [
        label, concept.threadId, concept.spaceId,
      ]);
    }
    return { label, labelNb };
  });
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export async function createRelation(
  q: QueryFn,
  input: { sourceId: string; targetId: string; type: unknown; actorUserId: string | null },
): Promise<{ id: string }> {
  const source = await loadConceptById(q, input.sourceId);
  await authorize(q, source.spaceId, input.actorUserId, 'createRelation');
  if (!isRelationType(input.type)) throw new ConceptError(400, 'invalid relation type');
  const targetId = requireUuid(input.targetId, 'target concept');
  if (targetId === source.id) throw new ConceptError(400, 'a concept cannot relate to itself');
  const target = await loadConceptById(q, targetId);
  if (target.spaceId !== source.spaceId) throw new ConceptError(400, 'concepts belong to different spaces');

  const existing = await run(
    q,
    `SELECT id FROM "ConceptRelation" WHERE "sourceId" = $1::uuid AND "targetId" = $2::uuid AND type = $3 LIMIT 1`,
    [source.id, target.id, input.type],
  );
  if (existing.length) throw new ConceptError(409, 'relation already exists');
  try {
    const rows = await run(
      q,
      `INSERT INTO "ConceptRelation" ("spaceId", "sourceId", "targetId", type, "createdBy")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid) RETURNING id`,
      [source.spaceId, source.id, target.id, input.type, input.actorUserId],
    );
    if (!rows.length) throw new ConceptError(500, 'relation insert returned nothing');
    return { id: rows[0].id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConceptError(409, 'relation already exists');
    throw err;
  }
}

export async function deleteRelation(
  q: QueryFn,
  input: { relationId: string; actorUserId: string | null },
): Promise<{ deleted: true }> {
  const id = requireUuid(input.relationId, 'relation');
  const rows = await run(
    q,
    `SELECT id, "spaceId", "createdBy" FROM "ConceptRelation" WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  const rel = rows[0];
  if (!rel) throw new ConceptError(404, 'relation not found');
  await authorize(q, rel.spaceId, input.actorUserId, 'deleteRelation', () => ({
    isOwnRelation: !!rel.createdBy && rel.createdBy === input.actorUserId,
  }));
  await run(q, `DELETE FROM "ConceptRelation" WHERE id = $1::uuid`, [id]);
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Listing and graph (public reads; no user fields)
// ---------------------------------------------------------------------------

export type ConceptListItem = {
  id: string;
  slug: string;
  label: string;
  labelNb: string | null;
  status: ConceptStatus;
  forum: { id: string; slug: string; title: string } | null;
  langs: ConceptLang[];
  updatedAt: string;
};

export async function listConcepts(
  q: QueryFn,
  { spaceId, forumId, status }: { spaceId: string; forumId?: string | null; status?: string | null },
): Promise<ConceptListItem[]> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId)) return [];
  if (forumId && !isUuid(forumId)) return [];
  if (status && !isConceptStatus(status)) throw new ConceptError(400, 'invalid status');
  const rows = await run(
    q,
    `SELECT c.id, c.slug, c.label, c."labelNb", c.status, c."updatedAt",
            f.id AS "forumId", f.slug AS "forumSlug", f.title AS "forumTitle",
            COALESCE((SELECT array_agg(DISTINCT v.lang) FROM "ConceptVersion" v WHERE v."conceptId" = c.id), '{}') AS langs
     FROM "Concept" c
     LEFT JOIN "ForumBoard" f ON f.id = c."forumId"
     WHERE c."spaceId" = $1::uuid
       AND ($2::uuid IS NULL OR c."forumId" = $2::uuid OR EXISTS (
         SELECT 1 FROM "ForumThread" ct WHERE ct.id = c."threadId" AND ct."boardId" = $2::uuid))
       AND ($3::text IS NULL OR c.status = $3)
     ORDER BY lower(c.label) ASC, c.id ASC`,
    [spaceId, forumId || null, status || null],
  );
  return rows.map((r: any) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    labelNb: r.labelNb ?? null,
    status: r.status,
    forum: r.forumId ? { id: r.forumId, slug: r.forumSlug, title: r.forumTitle } : null,
    langs: (Array.isArray(r.langs) ? r.langs : []).filter(isConceptLang).sort(),
    updatedAt: r.updatedAt,
  }));
}

export type GraphNode = {
  id: string; // slug
  label: string;
  labelNb: string | null;
  status: ConceptStatus;
  forum: string | null; // forum slug
};
export type GraphEdge = { source: string; target: string; type: RelationType };

/** Concept graph for a space (optionally one forum); edges only between included nodes. */
export async function graph(
  q: QueryFn,
  { spaceId, forumId, status }: { spaceId: string; forumId?: string | null; status?: string | null },
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const concepts = await listConcepts(q, { spaceId, forumId, status });
  if (!concepts.length) return { nodes: [], edges: [] };
  const slugById = new Map(concepts.map((c) => [c.id, c.slug]));
  const rels = await run(
    q,
    `SELECT "sourceId", "targetId", type FROM "ConceptRelation" WHERE "spaceId" = $1::uuid
     ORDER BY "createdAt" ASC, id ASC`,
    [spaceId],
  );
  const nodes: GraphNode[] = concepts.map((c) => ({
    id: c.slug,
    label: c.label,
    labelNb: c.labelNb,
    status: c.status,
    forum: c.forum?.slug ?? null,
  }));
  const edges: GraphEdge[] = [];
  for (const r of rels) {
    const source = slugById.get(r.sourceId);
    const target = slugById.get(r.targetId);
    if (source && target) edges.push({ source, target, type: r.type });
  }
  return { nodes, edges };
}
