// mm forum core on the generalized musiki forum tables (course XOR space):
// forums = ForumBoard rows with `spaceId`; threads = ForumThread rows with
// `spaceId` + `boardId`; posts carry an optional rhetorical `move` and the
// `adoptedAsVersionId` marker; votes reuse ForumPostVote (one row per user,
// values 1–3 as in musiki: useful / clarifies / reference; 0 removes).
// Spec §4, §5, §7 of docs/superpowers/specs/2026-09-28-mm-concept-machine-design.md.
//
// Pure module: no astro/db imports; every function takes `q: QueryFn` first
// (see concepts-core.ts for the conventions this follows). Every statement is
// pinned to the given space (`"spaceId" = $n`), so course rows are never read
// or touched from here — the mirror of the musiki routes' `"spaceId" IS NULL`.
//
// Privacy: reads expose display names (User.name) only — never emails or user
// ids; `settings.ownerEmail` is only returned by the curator-only admin read.
// Bodies are rendered at read time (like musiki) by the injected `render`
// (forum.ts binds musiki's renderForumMarkdown: KaTeX, LilyPond, @citekey).

import { can, type MmAction } from './policy.ts';
import { forumBibliographyKey, getCommonsRole, withTransaction, type QueryFn } from './concepts-core.ts';
import { isUuid, isValidEmail, normalizeEmail, type CommonsRole } from '../tenant/space-roles.ts';
import { slugify } from '../site/frontmatter.ts';
import { publicName } from './view.ts';

export type { QueryFn };

export const POST_MOVES = [
  'comment', 'proposes', 'contrasts', 'combines', 'exemplifies', 'problematises', 'synthesises',
] as const;
export type PostMove = (typeof POST_MOVES)[number];
export const isPostMove = (v: unknown): v is PostMove =>
  typeof v === 'string' && (POST_MOVES as readonly string[]).includes(v);

/** musiki ForumPostVote values (CHECK value IN (1,2,3)); 0 = remove my vote. */
export const VOTE_VALUES = [0, 1, 2, 3] as const;
export const MODERATION_ACTIONS = ['hide', 'unhide', 'delete'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const SETTINGS_KEYS = ['seshatLibraryId', 'zoteroCollection', 'ownerEmail'] as const;
export type ForumSettingsKey = (typeof SETTINGS_KEYS)[number];
export type ForumSettings = Partial<Record<ForumSettingsKey, string>>;

export class ForumError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ForumError';
    this.status = status;
  }
}

export type UserRef = { name: string | null; deleted: boolean };
/**
 * `post` identifies the rendered post (id + updatedAt) and its forum (whose
 * bibliography scopes citations) so callers can cache renders.
 */
export type RenderPostRef = {
  id: string;
  updatedAt: string | null;
  forumId?: string | null;
  /** Forum bibliography link (library id + owner) so re-linking invalidates cached renders. Never serialized. */
  forumBibliography?: string | null;
};
export type Render = (markdown: string, post?: RenderPostRef) => Promise<string>;

const TITLE_MIN = 3;
const FORUM_TITLE_MAX = 90;
const FORUM_SLUG_MAX = 48;
const FORUM_DESCRIPTION_MAX = 2000;
const THREAD_TITLE_MAX = 140;
const POST_BODY_MAX = 20000;
const THREAD_LIST_LIMIT = 200;
const POST_LIST_LIMIT = 1000;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIBRARY_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

// ---------------------------------------------------------------------------
// Query helpers (same conventions as concepts-core)
// ---------------------------------------------------------------------------

function toThrowable(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const err = new ForumError(500, message || 'database error');
  if (typeof error === 'object' && error !== null && 'code' in error) {
    (err as any).code = (error as { code: unknown }).code;
  }
  return err;
}

async function run(q: QueryFn, text: string, params: unknown[] = []): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw toThrowable(error);
  return data ?? [];
}

const isUniqueViolation = (err: unknown) => (err as { code?: unknown })?.code === '23505';

/** Public user reference: display name only (never one that looks like an e-mail), or deleted. */
const userRef = (id: string | null | undefined, name: string | null | undefined): UserRef =>
  id ? { name: publicName(name), deleted: false } : { name: null, deleted: true };

function requireUuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isUuid(value)) throw new ForumError(404, `${what} not found`);
  return value;
}

async function authorize(q: QueryFn, spaceId: string, actorUserId: string | null, action: MmAction): Promise<CommonsRole> {
  if (!actorUserId) throw new ForumError(401, 'sign in required');
  const role = await getCommonsRole(q, spaceId, actorUserId);
  if (!role || !can(role, action)) throw new ForumError(403, `not allowed: ${action}`);
  return role;
}

async function viewerRole(q: QueryFn, spaceId: string, viewerUserId: string | null | undefined): Promise<CommonsRole | null> {
  if (!viewerUserId || !isUuid(viewerUserId)) return null;
  return getCommonsRole(q, spaceId, viewerUserId);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanTitle(raw: unknown, max: number): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (title.length < TITLE_MIN) throw new ForumError(400, `title must be at least ${TITLE_MIN} characters`);
  if (title.length > max) throw new ForumError(400, 'title too long');
  return title;
}

function cleanDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ForumError(400, 'invalid description');
  const d = raw.trim();
  if (d.length > FORUM_DESCRIPTION_MAX) throw new ForumError(400, 'description too long');
  return d || null;
}

export function cleanPostBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw new ForumError(400, 'body required');
  if (body.length > POST_BODY_MAX) throw new ForumError(400, 'body too long');
  return body;
}

/** `undefined`/`null`/'' → null (a plain post); otherwise one of POST_MOVES. */
export function cleanMove(raw: unknown): PostMove | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!isPostMove(raw)) throw new ForumError(400, 'invalid move');
  return raw;
}

/** Forum slug from an explicit slug (validated) or the title (slugified). */
export function forumSlug(explicit: unknown, title: string): string {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    if (typeof explicit !== 'string') throw new ForumError(400, 'invalid slug');
    const s = explicit.trim().toLowerCase();
    // A uuid-shaped slug would be read as a forum id by the API (getForumRef).
    if (!SLUG_RE.test(s) || s.length > FORUM_SLUG_MAX || isUuid(s)) throw new ForumError(400, 'invalid slug');
    return s;
  }
  let s = slugify(title);
  if (s === 'page' && !/page/i.test(title)) s = 'forum';
  s = s.slice(0, FORUM_SLUG_MAX).replace(/-+$/, '');
  return s || 'forum';
}

/**
 * Validates a settings patch: only SETTINGS_KEYS; each value a valid string
 * (set) or null/'' (clear). Returns `{ key: value | null }`.
 */
export function cleanSettingsPatch(raw: unknown): Partial<Record<ForumSettingsKey, string | null>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ForumError(400, 'settings must be an object');
  const out: Partial<Record<ForumSettingsKey, string | null>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) throw new ForumError(400, `unknown setting: ${key}`);
    const k = key as ForumSettingsKey;
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      out[k] = null;
      continue;
    }
    if (typeof value !== 'string') throw new ForumError(400, `invalid ${k}`);
    const v = value.trim();
    if (k === 'seshatLibraryId') {
      if (!LIBRARY_ID_RE.test(v)) throw new ForumError(400, 'invalid seshatLibraryId');
      out[k] = v;
    } else if (k === 'zoteroCollection') {
      // A collection name (spaces allowed) or an https link to it (no whitespace).
      if (v.length > 500 || /[<>"\u0000-\u001f\u007f]/.test(v)) throw new ForumError(400, 'invalid zoteroCollection');
      const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(javascript|data|vbscript|file):/i.test(v);
      if (isUrl && !/^https:\/\/\S+$/i.test(v)) throw new ForumError(400, 'zoteroCollection URL must be https');
      out[k] = v;
    } else {
      const email = normalizeEmail(v);
      if (email.length > 320 || !isValidEmail(email)) throw new ForumError(400, 'invalid ownerEmail');
      out[k] = email;
    }
  }
  return out;
}

/** Own settings after applying a patch (set keys overwrite, null keys are removed). */
export function applySettingsPatch(own: unknown, patch: Partial<Record<ForumSettingsKey, string | null>>): ForumSettings {
  const out: ForumSettings = { ...parseSettings(own) };
  for (const [k, v] of Object.entries(patch)) {
    if (v) out[k as ForumSettingsKey] = v;
    else delete out[k as ForumSettingsKey];
  }
  return out;
}

const samePair = (a: ForumSettings, b: ForumSettings) =>
  (a.seshatLibraryId ?? '') === (b.seshatLibraryId ?? '') &&
  (a.ownerEmail ? normalizeEmail(a.ownerEmail) : '') === (b.ownerEmail ? normalizeEmail(b.ownerEmail) : '');

/**
 * Who may link a forum bibliography (spec: the library is read on behalf of
 * `ownerEmail`): space admins may set any owner/library; a curator's change to
 * `ownerEmail`/`seshatLibraryId` is judged on the EFFECTIVE result (a
 * channel's pair after inheritance, never the patch alone): when that result
 * is an active bibliography (library + owner) its owner must be one of the
 * curator's OWN emails (UserEmail rows). Results without an active
 * bibliography (cleared, library without owner) are always allowed, and so is
 * a channel falling back to exactly its group's pair (inheriting what an
 * admin or curator already set on the group).
 */
async function assertBibliographyAllowed(
  q: QueryFn,
  role: CommonsRole,
  actorUserId: string,
  patch: Partial<Record<ForumSettingsKey, string | null>>,
  current: { own: unknown; parent: unknown },
): Promise<void> {
  if (role === 'admin') return;
  if (!('ownerEmail' in patch) && !('seshatLibraryId' in patch)) return;
  const next = effectiveSettings(applySettingsPatch(current.own, patch), current.parent);
  if (!next.seshatLibraryId || !next.ownerEmail) return;
  if (current.parent !== null && current.parent !== undefined && samePair(next, parseSettings(current.parent))) return;
  await assertOwnEmail(q, actorUserId, normalizeEmail(next.ownerEmail));
}

/** The I4 rule's core: `owner` must be one of the actor's own UserEmail addresses. */
async function assertOwnEmail(q: QueryFn, actorUserId: string, owner: string): Promise<void> {
  const rows = await run(q, `SELECT lower("email") AS email FROM "UserEmail" WHERE "userId" = $1::uuid`, [actorUserId]);
  if (!rows.some((r) => String(r.email ?? '') === owner)) {
    throw new ForumError(403, 'only an admin can link a bibliography owned by someone else; use your own email');
  }
}

/**
 * Who may list an owner's Seshat libraries (admin library picker): the same
 * people and the same rule as linking one (assertBibliographyAllowed) —
 * curators/admins (manageForums); curators only for their OWN emails, admins
 * for any owner. Returns the normalized owner email.
 */
export async function authorizeOwnerLibraries(
  q: QueryFn,
  { spaceId, actorUserId, ownerEmail }: { spaceId: string; actorUserId: string | null; ownerEmail: unknown },
): Promise<string> {
  const sid = requireUuid(spaceId, 'space');
  const role = await authorize(q, sid, actorUserId, 'manageForums');
  const owner = typeof ownerEmail === 'string' ? normalizeEmail(ownerEmail) : '';
  if (!owner || owner.length > 320 || !isValidEmail(owner)) throw new ForumError(400, 'invalid owner email');
  if (role !== 'admin') await assertOwnEmail(q, actorUserId as string, owner);
  return owner;
}

function parseSettings(raw: unknown): ForumSettings {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: ForumSettings = {};
  for (const k of SETTINGS_KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/**
 * A channel's effective settings (spec: channels inherit the group's
 * bibliography unless they override it). The Seshat link — `seshatLibraryId`
 * + `ownerEmail` — is inherited as a PAIR: when the channel has its own value
 * for either key, only the channel's pair counts (a library without an owner
 * is then no bibliography at all), otherwise the group's pair. Never one key
 * from each: that would read the channel's library on behalf of the group's
 * owner. `zoteroCollection` is inherited on its own. For a top-level forum
 * `parent` is null and this is its own settings.
 */
export function effectiveSettings(own: unknown, parent: unknown): ForumSettings {
  const o = parseSettings(own);
  if (parent === null || parent === undefined) return o;
  const p = parseSettings(parent);
  const pair = o.seshatLibraryId || o.ownerEmail ? o : p;
  const out: ForumSettings = {};
  if (pair.seshatLibraryId) out.seshatLibraryId = pair.seshatLibraryId;
  if (pair.ownerEmail) out.ownerEmail = pair.ownerEmail;
  const zotero = o.zoteroCollection ?? p.zoteroCollection;
  if (zotero) out.zoteroCollection = zotero;
  return out;
}

/** Reserved channel slug: /f/<group>/t/<thread> is a thread of the group itself. */
export const RESERVED_CHANNEL_SLUGS = ['t'] as const;

/** What anyone may see about a forum's bibliography: never the owner email or library id. */
export function publicSettings(raw: unknown): { zoteroCollection: string | null; hasBibliography: boolean } {
  const s = parseSettings(raw);
  return {
    zoteroCollection: s.zoteroCollection ?? null,
    hasBibliography: !!(s.seshatLibraryId && s.ownerEmail),
  };
}

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

export type ForumRef = { id: string; slug: string; title: string };

export type ForumSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** Parent group of a channel; null for a top-level forum ("group"). */
  parent: ForumRef | null;
  /** Public view of the EFFECTIVE settings (a channel inherits its group's). */
  settings: { zoteroCollection: string | null; hasBibliography: boolean };
  /** Whether a channel has its own Seshat link (library + owner pair) instead of its group's. */
  overridesBibliography: boolean;
  /** Active threads of the forum and, for a group, of its active channels. */
  threadCount: number;
  conceptCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Active channels (groups only; always [] for a channel). */
  channels: ForumSummary[];
};

/** Board `b` and its active channels (the threads a board "contains"). */
const SUBTREE = (thread: string) =>
  `(${thread}."boardId" = b.id OR ${thread}."boardId" IN (
     SELECT ch.id FROM "ForumBoard" ch WHERE ch."parentId" = b.id AND ch."isArchived" = false))`;

const FORUM_SELECT = `SELECT b.id, b.slug, b.title, b.description, b.settings, b."parentId", b.position, b."createdAt", b."updatedAt",
       pb.slug AS "parentSlug", pb.title AS "parentTitle", pb.settings AS "parentSettings",
       (SELECT count(*) FROM "ForumThread" t
         WHERE ${SUBTREE('t')} AND t."spaceId" = b."spaceId" AND t."archivedAt" IS NULL)::int AS "threadCount",
       (SELECT count(*) FROM "Concept" c
         WHERE c."spaceId" = b."spaceId" AND (c."forumId" = b.id OR EXISTS (
           SELECT 1 FROM "ForumThread" ct WHERE ct.id = c."threadId" AND ct."boardId" = b.id)))::int AS "conceptCount",
       (SELECT max(p."createdAt") FROM "ForumPost" p JOIN "ForumThread" t ON t.id = p."threadId"
         WHERE ${SUBTREE('t')} AND t."spaceId" = b."spaceId" AND p.status = 'published') AS "lastActivityAt"
  FROM "ForumBoard" b
  LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"`;

/** Active board: not archived, and (for a channel) its group not archived either. */
const ACTIVE_BOARD = `b."isArchived" = false AND (pb.id IS NULL OR pb."isArchived" = false)`;

const toForumSummary = (r: any): ForumSummary => {
  const parent = r.parentId ? { id: r.parentId, slug: r.parentSlug, title: r.parentTitle } : null;
  const own = parseSettings(r.settings);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? null,
    parent,
    settings: publicSettings(effectiveSettings(r.settings, parent ? r.parentSettings ?? {} : null)),
    overridesBibliography: !!parent && !!(own.seshatLibraryId || own.ownerEmail),
    threadCount: Number(r.threadCount ?? 0),
    conceptCount: Number(r.conceptCount ?? 0),
    lastActivityAt: r.lastActivityAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    channels: [],
  };
};

/**
 * Channel order within a group: the manual `position` first (ascending), then
 * channels without a position in order of creation (the default), then id.
 */
export function compareChannels(
  a: { position?: number | null; createdAt?: string | null; id: string },
  b: { position?: number | null; createdAt?: string | null; id: string },
): number {
  const pa = a.position ?? Number.POSITIVE_INFINITY;
  const pb = b.position ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa < pb ? -1 : 1;
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Nests channel rows under their group rows in channel order (orphans — group not in the list — are dropped). */
function nestForums(rows: any[]): ForumSummary[] {
  const all = rows.map(toForumSummary);
  const order = new Map(rows.map((r: any) => [r.id, { id: r.id, position: r.position ?? null, createdAt: r.createdAt ?? null }]));
  const groups = all.filter((f) => !f.parent);
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const f of all) if (f.parent) byId.get(f.parent.id)?.channels.push(f);
  for (const g of groups) g.channels.sort((x, y) => compareChannels(order.get(x.id)!, order.get(y.id)!));
  return groups;
}

/** Public: the space's active groups (top-level forums), alphabetical, each with its active channels. */
export async function listForums(q: QueryFn, { spaceId }: { spaceId: string }): Promise<ForumSummary[]> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId)) return [];
  const rows = await run(
    q,
    `${FORUM_SELECT}
     WHERE b."spaceId" = $1::uuid AND b."isArchived" = false AND (pb.id IS NULL OR pb."isArchived" = false)
     ORDER BY lower(b.title) ASC, b.id ASC`,
    [spaceId],
  );
  return nestForums(rows);
}

/** Public: one active group (top-level forum) by slug, with its active channels, or null. */
export async function getForum(q: QueryFn, { spaceId, slug }: { spaceId: string; slug: string }): Promise<ForumSummary | null> {
  return (await getForumByPath(q, { spaceId, group: slug }))?.group ?? null;
}

/**
 * Public: a group by slug and optionally one of its channels by slug (the
 * path /f/<group>[/<channel>]). Null when the group is missing/archived, or
 * when `channel` is given and is not an active channel OF THAT GROUP.
 */
export async function getForumByPath(
  q: QueryFn,
  { spaceId, group, channel = null }: { spaceId: string; group: string; channel?: string | null },
): Promise<{ group: ForumSummary; channel: ForumSummary | null } | null> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId) || typeof group !== 'string' || !SLUG_RE.test(group)) return null;
  if (channel !== null && (typeof channel !== 'string' || !SLUG_RE.test(channel) || isReservedChannelSlug(channel))) return null;
  const rows = await run(
    q,
    `${FORUM_SELECT}
     WHERE b."spaceId" = $1::uuid AND ${ACTIVE_BOARD}
       AND ((b."parentId" IS NULL AND b.slug = $2) OR (pb."parentId" IS NULL AND pb.slug = $2))
     ORDER BY lower(b.title) ASC, b.id ASC`,
    [spaceId, group],
  );
  const [g] = nestForums(rows);
  if (!g || g.slug !== group) return null;
  if (channel === null) return { group: g, channel: null };
  const c = g.channels.find((ch) => ch.slug === channel);
  return c ? { group: g, channel: c } : null;
}

/**
 * Public: an active forum (group or channel) by API reference — a forum id
 * (any level) or a group slug. Channels have no space-unique slug, so the
 * API addresses them by id. Groups come with their channels.
 */
export async function getForumRef(q: QueryFn, { spaceId, ref }: { spaceId: string; ref: unknown }): Promise<ForumSummary | null> {
  if (typeof ref !== 'string' || !ref) return null;
  if (!isUuid(ref)) return getForum(q, { spaceId, slug: ref });
  if (typeof spaceId !== 'string' || !isUuid(spaceId)) return null;
  const rows = await run(
    q,
    `${FORUM_SELECT}
     WHERE b."spaceId" = $1::uuid AND ${ACTIVE_BOARD}
       AND (b.id = $2::uuid OR b."parentId" = $2::uuid)
     ORDER BY lower(b.title) ASC, b.id ASC`,
    [spaceId, ref],
  );
  const own = rows.find((r: any) => r.id === ref);
  if (!own) return null;
  if (own.parentId) return toForumSummary(own);
  return nestForums(rows)[0] ?? null;
}

export const isReservedChannelSlug = (slug: string) => (RESERVED_CHANNEL_SLUGS as readonly string[]).includes(slug);

export type ForumAdminView = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isArchived: boolean;
  /** Group of a channel; null for a top-level forum. */
  parentId: string | null;
  /** Manual channel order (null: after the ordered channels, by creation). */
  position: number | null;
  createdAt: string | null;
  /** The forum's OWN settings (a channel inherits the group's library+owner pair when it has neither). */
  settings: ForumSettings;
};

const ADMIN_COLUMNS = `id, slug, title, description, "isArchived", settings, "parentId", position, "createdAt"`;

const toAdminView = (r: any): ForumAdminView => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  description: r.description ?? null,
  isArchived: !!r.isArchived,
  parentId: r.parentId ?? null,
  position: r.position === null || r.position === undefined ? null : Number(r.position),
  createdAt: r.createdAt ?? null,
  settings: parseSettings(r.settings),
});

/**
 * A forum of the space by id, with its group's archive flag and settings.
 * A channel of an archived group counts as archived.
 */
async function loadSpaceForum(q: QueryFn, spaceId: string, forumId: unknown, opts: { includeArchived?: boolean } = {}) {
  const id = requireUuid(forumId, 'forum');
  const rows = await run(
    q,
    `SELECT b.id, b.slug, b.title, b.description, b."isArchived", b.settings, b."parentId",
            pb."isArchived" AS "parentArchived", pb.settings AS "parentSettings"
     FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
     WHERE b.id = $1::uuid AND b."spaceId" = $2::uuid LIMIT 1`,
    [id, spaceId],
  );
  const f = rows[0];
  if (!f || (!opts.includeArchived && (f.isArchived || f.parentArchived))) throw new ForumError(404, 'forum not found');
  return f;
}

/** Curators/admins: all forums of the space incl. archived, with full settings (ownerEmail). */
export async function listForumsAdmin(
  q: QueryFn,
  { spaceId, actorUserId }: { spaceId: string; actorUserId: string | null },
): Promise<ForumAdminView[]> {
  const sid = requireUuid(spaceId, 'space');
  await authorize(q, sid, actorUserId, 'manageForums');
  const rows = await run(
    q,
    `SELECT ${ADMIN_COLUMNS} FROM "ForumBoard"
     WHERE "spaceId" = $1::uuid ORDER BY "isArchived" ASC, lower(title) ASC, id ASC`,
    [sid],
  );
  return rows.map(toAdminView);
}

/**
 * Curators/admins: a top-level forum ("group"), or — with `parentId` — a
 * channel of a group. One level only: the parent must be an active top-level
 * forum of the space. Slugs are unique among siblings (groups per space,
 * channels per group); the channel slug "t" is reserved. A channel's
 * bibliography override is checked against the settings it would otherwise
 * inherit (a curator cannot pair a library id with a group owner that is not
 * theirs).
 */
export async function createForum(
  q: QueryFn,
  input: {
    spaceId: string;
    actorUserId: string | null;
    title: unknown;
    slug?: unknown;
    description?: unknown;
    settings?: unknown;
    parentId?: unknown;
  },
): Promise<ForumAdminView> {
  const spaceId = requireUuid(input.spaceId, 'space');
  const role = await authorize(q, spaceId, input.actorUserId, 'manageForums');
  const title = cleanTitle(input.title, FORUM_TITLE_MAX);
  const slug = forumSlug(input.slug, title);
  const description = cleanDescription(input.description);
  const patch = cleanSettingsPatch(input.settings);

  let parent: any = null;
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== '') {
    if (typeof input.parentId !== 'string' || !isUuid(input.parentId)) throw new ForumError(400, 'invalid parent forum');
    parent = await loadSpaceForum(q, spaceId, input.parentId);
    if (parent.parentId) throw new ForumError(400, 'channels cannot have channels');
    if (isReservedChannelSlug(slug)) throw new ForumError(400, `the channel slug "${slug}" is reserved`);
  }
  await assertBibliographyAllowed(q, role, input.actorUserId as string, patch, {
    own: {}, parent: parent ? parent.settings ?? {} : null,
  });
  const settings: ForumSettings = {};
  for (const [k, v] of Object.entries(patch)) if (v) settings[k as ForumSettingsKey] = v;

  const taken = await run(
    q,
    `SELECT id FROM "ForumBoard" WHERE "spaceId" = $1::uuid AND slug = $2 AND "parentId" IS NOT DISTINCT FROM $3::uuid LIMIT 1`,
    [spaceId, slug, parent?.id ?? null],
  );
  if (taken.length) throw new ForumError(409, parent ? 'a channel with this slug already exists in this forum' : 'a forum with this slug already exists');
  try {
    const rows = await run(
      q,
      `INSERT INTO "ForumBoard" ("spaceId", slug, title, description, "createdByUserId", settings, "parentId")
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7::uuid)
       RETURNING ${ADMIN_COLUMNS}`,
      [spaceId, slug, title, description, input.actorUserId, JSON.stringify(settings), parent?.id ?? null],
    );
    if (!rows.length) throw new ForumError(500, 'forum insert returned nothing');
    return toAdminView(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ForumError(409, 'a forum with this slug already exists');
    if ((err as { code?: unknown })?.code === '23514') throw new ForumError(400, 'invalid channel');
    throw err;
  }
}

/**
 * Curators/admins: title, description, archive flag, and a settings patch
 * (keys set or cleared individually; other keys kept). The slug never changes.
 */
export async function updateForum(
  q: QueryFn,
  input: {
    spaceId: string;
    forumId: string;
    actorUserId: string | null;
    title?: unknown;
    description?: unknown;
    settings?: unknown;
    isArchived?: unknown;
  },
): Promise<ForumAdminView> {
  const spaceId = requireUuid(input.spaceId, 'space');
  const role = await authorize(q, spaceId, input.actorUserId, 'manageForums');
  const forum = await loadSpaceForum(q, spaceId, input.forumId, { includeArchived: true });

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    sets.push(sql(`$${params.length}`));
  };
  if (input.title !== undefined) push((n) => `title = ${n}`, cleanTitle(input.title, FORUM_TITLE_MAX));
  if (input.description !== undefined) push((n) => `description = ${n}`, cleanDescription(input.description));
  if (input.isArchived !== undefined) {
    if (typeof input.isArchived !== 'boolean') throw new ForumError(400, 'isArchived must be a boolean');
    push((n) => `"isArchived" = ${n}`, input.isArchived);
  }
  if (input.settings !== undefined) {
    const patch = cleanSettingsPatch(input.settings);
    // Judged on the effective result after the patch (a channel inherits its group's pair).
    await assertBibliographyAllowed(q, role, input.actorUserId as string, patch, {
      own: forum.settings, parent: forum.parentId ? forum.parentSettings ?? {} : null,
    });
    if (Object.keys(patch).length) {
      // Merge: set keys overwrite, null keys are removed (settings values are flat strings).
      push((n) => `settings = jsonb_strip_nulls(COALESCE(settings, '{}'::jsonb) || ${n}::jsonb)`, JSON.stringify(patch));
    }
  }
  if (!sets.length) throw new ForumError(400, 'nothing to update');

  params.push(forum.id, spaceId);
  const rows = await run(
    q,
    `UPDATE "ForumBoard" SET ${sets.join(', ')}, "updatedAt" = now()
     WHERE id = $${params.length - 1}::uuid AND "spaceId" = $${params.length}::uuid
     RETURNING ${ADMIN_COLUMNS}`,
    params,
  );
  if (!rows.length) throw new ForumError(404, 'forum not found');
  return toAdminView(rows[0]);
}

/**
 * Curators/admins: the manual order of a group's channels. `order` must list
 * every channel of the group (archived included) exactly once; positions
 * become 1…n in that order, in one statement pinned to the group and space.
 */
export async function reorderChannels(
  q: QueryFn,
  input: { spaceId: string; groupId: string; actorUserId: string | null; order: unknown },
): Promise<ForumAdminView[]> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'manageForums');
  const group = await loadSpaceForum(q, spaceId, input.groupId, { includeArchived: true });
  if (group.parentId) throw new ForumError(400, 'channels have no channels');
  const order = input.order;
  if (!Array.isArray(order) || order.length > 500 || !order.every((v) => typeof v === 'string' && isUuid(v))) {
    throw new ForumError(400, 'order must be a list of channel ids');
  }
  const current = await run(
    q,
    `SELECT id FROM "ForumBoard" WHERE "parentId" = $1::uuid AND "spaceId" = $2::uuid`,
    [group.id, spaceId],
  );
  const ids = new Set(current.map((r: any) => String(r.id)));
  if (new Set(order).size !== order.length || order.length !== ids.size || !order.every((v) => ids.has(v as string))) {
    throw new ForumError(409, 'the order must list every channel of the forum exactly once');
  }
  const rows = await run(
    q,
    `UPDATE "ForumBoard" b SET position = o.ord::int, "updatedAt" = now()
     FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
     WHERE b.id = o.id AND b."parentId" = $2::uuid AND b."spaceId" = $3::uuid
     RETURNING b.id, b.slug, b.title, b.description, b."isArchived", b.settings, b."parentId", b.position, b."createdAt"`,
    [order, group.id, spaceId],
  );
  return rows.map(toAdminView).sort(compareChannels);
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export type ThreadSummary = {
  id: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  createdBy: UserRef;
  /** Whether the viewer started it; never the user id itself. */
  own: boolean;
  concept: { slug: string; label: string } | null;
  postCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
};

/** Public: threads of an active forum of the space, pinned first then most recent. */
export async function listThreads(
  q: QueryFn,
  { spaceId, forumId, viewerUserId = null }: { spaceId: string; forumId: string; viewerUserId?: string | null },
): Promise<ThreadSummary[]> {
  const sid = requireUuid(spaceId, 'space');
  const forum = await loadSpaceForum(q, sid, forumId);
  const rows = await run(
    q,
    `SELECT t.id, t.title, t."isPinned", t."isLocked", t."createdAt", t."updatedAt", t."createdByUserId",
            u.name AS "createdByName", c.slug AS "conceptSlug", c.label AS "conceptLabel",
            (SELECT count(*) FROM "ForumPost" p WHERE p."threadId" = t.id AND p.status = 'published')::int AS "postCount",
            (SELECT max(p."createdAt") FROM "ForumPost" p WHERE p."threadId" = t.id AND p.status = 'published') AS "lastPostAt"
     FROM "ForumThread" t
     LEFT JOIN "User" u ON u.id = t."createdByUserId"
     LEFT JOIN LATERAL (
       SELECT c.slug, c.label FROM "Concept" c
       WHERE c."threadId" = t.id AND c."spaceId" = t."spaceId"
       ORDER BY c."createdAt" ASC, c.id ASC LIMIT 1
     ) c ON true
     WHERE t."spaceId" = $1::uuid AND t."boardId" = $2::uuid AND t."archivedAt" IS NULL
     ORDER BY t."isPinned" DESC, t."updatedAt" DESC, t.id DESC
     LIMIT ${THREAD_LIST_LIMIT}`,
    [sid, forum.id],
  );
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    isPinned: !!r.isPinned,
    isLocked: !!r.isLocked,
    createdBy: userRef(r.createdByUserId, r.createdByName),
    own: !!viewerUserId && r.createdByUserId === viewerUserId,
    concept: r.conceptSlug ? { slug: r.conceptSlug, label: r.conceptLabel } : null,
    postCount: Number(r.postCount ?? 0),
    lastActivityAt: latest(r.updatedAt, r.lastPostAt),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function latest(a: string | null, b: string | null): string {
  if (!a) return b as string;
  if (!b) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

/** Members+: a thread in an active forum of the space, with its first post. One transaction. */
export async function createThread(
  q: QueryFn,
  input: { spaceId: string; forumId: string; actorUserId: string | null; title: unknown; body: unknown; move?: unknown },
): Promise<{ threadId: string; postId: string }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'post');
  const title = cleanTitle(input.title, THREAD_TITLE_MAX);
  const body = cleanPostBody(input.body);
  const move = cleanMove(input.move);
  const forum = await loadSpaceForum(q, spaceId, input.forumId);

  return withTransaction(q, async () => {
    const t = await run(
      q,
      `INSERT INTO "ForumThread" ("spaceId", "boardId", title, "createdByUserId")
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid) RETURNING id`,
      [spaceId, forum.id, title, input.actorUserId],
    );
    const threadId = t[0]?.id;
    if (!threadId) throw new ForumError(500, 'thread insert returned nothing');
    const p = await run(
      q,
      `INSERT INTO "ForumPost" ("threadId", "authorUserId", body, move)
       VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id`,
      [threadId, input.actorUserId, body, move],
    );
    const postId = p[0]?.id;
    if (!postId) throw new ForumError(500, 'post insert returned nothing');
    return { threadId, postId };
  });
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export type VoteCounts = { useful: number; clarifies: number; reference: number; total: number };

export type PostView = {
  id: string;
  parentPostId: string | null;
  move: PostMove | null;
  status: 'published' | 'hidden' | 'deleted';
  /** Markdown source; null when not visible to the viewer (hidden/deleted). */
  body: string | null;
  bodyHtml: string;
  author: UserRef;
  own: boolean;
  votes: VoteCounts;
  /** Viewer's vote (0 = none). */
  myVote: number;
  /** Set when a curator adopted this post as a concept definition version. */
  adopted: { versionId: string; lang: string | null; conceptSlug: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type ThreadView = {
  thread: {
    id: string;
    title: string;
    isPinned: boolean;
    isLocked: boolean;
    createdBy: UserRef;
    /** The thread's board (a group or a channel) and, for a channel, its group. */
    forum: (ForumRef & { parent: ForumRef | null }) | null;
    concept: { slug: string; label: string } | null;
    createdAt: string;
    updatedAt: string;
  };
  posts: PostView[];
  viewer: { role: CommonsRole | null; canPost: boolean; canVote: boolean; canModerate: boolean; canAdopt: boolean };
};

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const plainRender: Render = async (md) => `<p>${escapeHtml(md)}</p>`;

async function safeRender(render: Render, body: string, post?: RenderPostRef): Promise<string> {
  try {
    return await render(body, post);
  } catch (err) {
    console.error('[mm/forum-core] markdown render failed:', err);
    return plainRender(body);
  }
}

const emptyVotes = (): VoteCounts => ({ useful: 0, clarifies: 0, reference: 0, total: 0 });
const VOTE_KEY: Record<number, keyof Omit<VoteCounts, 'total'>> = { 1: 'useful', 2: 'clarifies', 3: 'reference' };

/**
 * Public: a thread of the space with its posts (oldest first), rendered at
 * read time. Hidden posts show their body only to moderators; deleted posts
 * never do. Returns null when the thread is not in this space or archived.
 */
export async function listPosts(
  q: QueryFn,
  {
    spaceId,
    threadId,
    viewerUserId = null,
    render = plainRender,
  }: { spaceId: string; threadId: string; viewerUserId?: string | null; render?: Render },
): Promise<ThreadView | null> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId) || typeof threadId !== 'string' || !isUuid(threadId)) return null;
  const threads = await run(
    q,
    `SELECT t.id, t.title, t."isPinned", t."isLocked", t."createdAt", t."updatedAt", t."archivedAt",
            t."createdByUserId", u.name AS "createdByName",
            b.id AS "forumId", b.slug AS "forumSlug", b.title AS "forumTitle",
            (b."isArchived" OR COALESCE(pb."isArchived", false)) AS "forumArchived",
            b.settings AS "forumSettings",
            pb.id AS "parentId", pb.slug AS "parentSlug", pb.title AS "parentTitle", pb.settings AS "parentSettings",
            c.slug AS "conceptSlug", c.label AS "conceptLabel"
     FROM "ForumThread" t
     LEFT JOIN "User" u ON u.id = t."createdByUserId"
     LEFT JOIN "ForumBoard" b ON b.id = t."boardId" AND b."spaceId" = t."spaceId"
     LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
     LEFT JOIN LATERAL (
       SELECT c.slug, c.label FROM "Concept" c
       WHERE c."threadId" = t.id AND c."spaceId" = t."spaceId"
       ORDER BY c."createdAt" ASC, c.id ASC LIMIT 1
     ) c ON true
     WHERE t.id = $1::uuid AND t."spaceId" = $2::uuid
     LIMIT 1`,
    [threadId, spaceId],
  );
  const t = threads[0];
  if (!t || t.archivedAt || t.forumArchived) return null;

  const role = await viewerRole(q, spaceId, viewerUserId);
  const canModerate = can(role, 'moderate');
  // Channels inherit their group's library+owner pair (effectiveSettings); the
  // renderer resolves citations by the board id, the cache key carries the effective link.
  const forumBibliography = forumBibliographyKey(effectiveSettings(t.forumSettings, t.parentId ? t.parentSettings ?? {} : null));

  const rows = await run(
    q,
    `SELECT p.id, p."parentPostId", p."authorUserId", p.body, p.status, p.move, p."adoptedAsVersionId",
            p."createdAt", p."updatedAt", u.name AS "authorName",
            av.lang AS "adoptedLang", ac.slug AS "adoptedConceptSlug"
     FROM "ForumPost" p
     LEFT JOIN "User" u ON u.id = p."authorUserId"
     LEFT JOIN "ConceptVersion" av ON av.id = p."adoptedAsVersionId"
     LEFT JOIN "Concept" ac ON ac.id = av."conceptId"
     WHERE p."threadId" = $1::uuid
     ORDER BY p."createdAt" ASC, p.id ASC
     LIMIT ${POST_LIST_LIMIT}`,
    [t.id],
  );

  const voteRows = await run(
    q,
    `SELECT v."postId", v.value, count(*)::int AS n, bool_or(v."userId" = $2::uuid) AS mine
     FROM "ForumPostVote" v JOIN "ForumPost" p ON p.id = v."postId"
     WHERE p."threadId" = $1::uuid
     GROUP BY v."postId", v.value`,
    [t.id, viewerUserId && isUuid(viewerUserId) ? viewerUserId : null],
  );
  const votesByPost = new Map<string, { votes: VoteCounts; mine: number }>();
  for (const v of voteRows) {
    const key = VOTE_KEY[Number(v.value)];
    if (!key) continue;
    const entry = votesByPost.get(v.postId) ?? { votes: emptyVotes(), mine: 0 };
    entry.votes[key] += Number(v.n ?? 0);
    entry.votes.total += Number(v.n ?? 0);
    if (v.mine === true) entry.mine = Number(v.value);
    votesByPost.set(v.postId, entry);
  }

  const posts: PostView[] = [];
  for (const p of rows) {
    const status = p.status === 'hidden' || p.status === 'deleted' ? p.status : 'published';
    const visible = status === 'published' || (status === 'hidden' && canModerate);
    const body = visible ? String(p.body ?? '') : null;
    const v = votesByPost.get(p.id);
    posts.push({
      id: p.id,
      parentPostId: p.parentPostId ?? null,
      move: isPostMove(p.move) ? p.move : null,
      status,
      body,
      bodyHtml: body ? await safeRender(render, body, { id: p.id, updatedAt: p.updatedAt ?? null, forumId: t.forumId ?? null, forumBibliography }) : '',
      author: userRef(p.authorUserId, p.authorName),
      own: !!viewerUserId && p.authorUserId === viewerUserId,
      votes: v?.votes ?? emptyVotes(),
      myVote: v?.mine ?? 0,
      adopted: p.adoptedAsVersionId
        ? { versionId: p.adoptedAsVersionId, lang: p.adoptedLang ?? null, conceptSlug: p.adoptedConceptSlug ?? null }
        : null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }

  return {
    thread: {
      id: t.id,
      title: t.title,
      isPinned: !!t.isPinned,
      isLocked: !!t.isLocked,
      createdBy: userRef(t.createdByUserId, t.createdByName),
      forum: t.forumId
        ? {
            id: t.forumId, slug: t.forumSlug, title: t.forumTitle,
            parent: t.parentId ? { id: t.parentId, slug: t.parentSlug, title: t.parentTitle } : null,
          }
        : null,
      concept: t.conceptSlug ? { slug: t.conceptSlug, label: t.conceptLabel } : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    posts,
    viewer: {
      role,
      canPost: can(role, 'post') && (!t.isLocked || canModerate),
      canVote: can(role, 'vote'),
      canModerate,
      canAdopt: can(role, 'adoptPost'),
    },
  };
}

/** A thread of the space that is open: not archived, and its forum not archived. */
async function loadSpaceThread(q: QueryFn, spaceId: string, threadId: unknown) {
  const id = requireUuid(threadId, 'thread');
  const rows = await run(
    q,
    `SELECT t.id, t."isLocked", t."archivedAt", (b."isArchived" OR COALESCE(pb."isArchived", false)) AS "forumArchived"
     FROM "ForumThread" t LEFT JOIN "ForumBoard" b ON b.id = t."boardId" LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
     WHERE t.id = $1::uuid AND t."spaceId" = $2::uuid LIMIT 1`,
    [id, spaceId],
  );
  const t = rows[0];
  if (!t || t.archivedAt || t.forumArchived) throw new ForumError(404, 'thread not found');
  return t;
}

/** A post of the space with its thread/forum archive state. */
async function loadSpacePost(q: QueryFn, spaceId: string, postId: unknown) {
  const id = requireUuid(postId, 'post');
  const rows = await run(
    q,
    `SELECT p.id, p."threadId", p.status, t."archivedAt" AS "threadArchived",
            (b."isArchived" OR COALESCE(pb."isArchived", false)) AS "forumArchived"
     FROM "ForumPost" p JOIN "ForumThread" t ON t.id = p."threadId"
     LEFT JOIN "ForumBoard" b ON b.id = t."boardId" LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
     WHERE p.id = $1::uuid AND t."spaceId" = $2::uuid
     LIMIT 1`,
    [id, spaceId],
  );
  if (!rows.length) throw new ForumError(404, 'post not found');
  return rows[0];
}

/** SQL predicate: the post `$postParam` is published in an open thread/forum of space `$spaceParam`. */
const OPEN_PUBLISHED_POST = (postParam: string, spaceParam: string) =>
  `EXISTS (SELECT 1 FROM "ForumPost" op JOIN "ForumThread" ot ON ot.id = op."threadId"
            LEFT JOIN "ForumBoard" ob ON ob.id = ot."boardId"
            LEFT JOIN "ForumBoard" opb ON opb.id = ob."parentId"
            WHERE op.id = ${postParam}::uuid AND op.status = 'published' AND ot."spaceId" = ${spaceParam}::uuid
              AND ot."archivedAt" IS NULL AND ob."isArchived" IS NOT TRUE AND opb."isArchived" IS NOT TRUE)`;

/**
 * Members+: a post (optionally a reply, optionally with a move) in a thread of
 * the space. Locked threads accept posts from moderators only. The parent must
 * be a post of the same thread. One transaction (post + thread activity).
 */
export async function createPost(
  q: QueryFn,
  input: {
    spaceId: string;
    threadId: string;
    actorUserId: string | null;
    body: unknown;
    move?: unknown;
    parentPostId?: unknown;
  },
): Promise<{ id: string; threadId: string; parentPostId: string | null; move: PostMove | null; createdAt: string }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  const role = await authorize(q, spaceId, input.actorUserId, 'post');
  const body = cleanPostBody(input.body);
  const move = cleanMove(input.move);
  const thread = await loadSpaceThread(q, spaceId, input.threadId);
  if (thread.isLocked && !can(role, 'moderate')) throw new ForumError(403, 'thread is locked');

  let parentPostId: string | null = null;
  if (input.parentPostId !== undefined && input.parentPostId !== null && input.parentPostId !== '') {
    if (typeof input.parentPostId !== 'string' || !isUuid(input.parentPostId)) throw new ForumError(400, 'invalid parent post');
    const parent = await run(
      q,
      `SELECT id FROM "ForumPost" WHERE id = $1::uuid AND "threadId" = $2::uuid LIMIT 1`,
      [input.parentPostId, thread.id],
    );
    if (!parent.length) throw new ForumError(400, 'parent post is not in this thread');
    parentPostId = parent[0].id;
  }

  return withTransaction(q, async () => {
    const rows = await run(
      q,
      `INSERT INTO "ForumPost" ("threadId", "authorUserId", "parentPostId", body, move)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id, "createdAt"`,
      [thread.id, input.actorUserId, parentPostId, body, move],
    );
    if (!rows.length) throw new ForumError(500, 'post insert returned nothing');
    await run(q, `UPDATE "ForumThread" SET "updatedAt" = now() WHERE id = $1::uuid AND "spaceId" = $2::uuid`, [
      thread.id,
      spaceId,
    ]);
    return { id: rows[0].id, threadId: thread.id, parentPostId, move, createdAt: rows[0].createdAt };
  });
}

/**
 * Guests+: one vote per user per post (musiki values 1 useful, 2 clarifies,
 * 3 reference; 0 removes it). Only published posts of the space.
 */
export async function vote(
  q: QueryFn,
  input: { spaceId: string; postId: string; actorUserId: string | null; value: unknown },
): Promise<{ postId: string; votes: VoteCounts; myVote: number }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'vote');
  const value = Number(input.value);
  if (typeof input.value !== 'number' || !(VOTE_VALUES as readonly number[]).includes(value)) {
    throw new ForumError(400, 'value must be 0, 1, 2 or 3');
  }
  const post = await loadSpacePost(q, spaceId, input.postId);
  if (post.threadArchived || post.forumArchived) throw new ForumError(404, 'post not found');
  if (post.status !== 'published') throw new ForumError(409, 'post is not published');

  // Writes re-check the post (published, open thread/forum, this space) in the
  // same statement, so a concurrent hide/archive cannot be raced.
  if (value === 0) {
    await run(
      q,
      `DELETE FROM "ForumPostVote" WHERE "postId" = $1::uuid AND "userId" = $2::uuid
       AND ${OPEN_PUBLISHED_POST('$1', '$3')}`,
      [post.id, input.actorUserId, spaceId],
    );
  } else {
    const written = await run(
      q,
      `INSERT INTO "ForumPostVote" ("postId", "userId", value)
       SELECT $1::uuid, $2::uuid, $3::smallint
       WHERE ${OPEN_PUBLISHED_POST('$1', '$4')}
       ON CONFLICT ("postId", "userId") DO UPDATE SET value = EXCLUDED.value
       RETURNING value`,
      [post.id, input.actorUserId, value, spaceId],
    );
    if (!written.length) throw new ForumError(409, 'post is not open for votes');
  }

  const rows = await run(q, `SELECT "userId", value FROM "ForumPostVote" WHERE "postId" = $1::uuid`, [post.id]);
  const votes = emptyVotes();
  let myVote = 0;
  for (const r of rows) {
    const key = VOTE_KEY[Number(r.value)];
    if (!key) continue;
    votes[key] += 1;
    votes.total += 1;
    if (r.userId === input.actorUserId) myVote = Number(r.value);
  }
  return { postId: post.id, votes, myVote };
}

/**
 * Curators/admins: hide (published → hidden), unhide (hidden → published) or
 * delete (soft, as musiki: body cleared, status 'deleted'; terminal).
 */
export async function moderatePost(
  q: QueryFn,
  input: { spaceId: string; postId: string; actorUserId: string | null; action: unknown },
): Promise<{ postId: string; status: 'published' | 'hidden' | 'deleted' }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'moderate');
  const action = input.action;
  if (typeof action !== 'string' || !(MODERATION_ACTIONS as readonly string[]).includes(action)) {
    throw new ForumError(400, 'invalid moderation action');
  }
  const post = await loadSpacePost(q, spaceId, input.postId);
  if (post.status === 'deleted') throw new ForumError(409, 'post is deleted');
  if (action === 'hide' && post.status !== 'published') throw new ForumError(409, 'post is not published');
  if (action === 'unhide' && post.status !== 'hidden') throw new ForumError(409, 'post is not hidden');

  // Pinned update: only applies if the post is still in the status we read and
  // still in this space; otherwise another moderator got there first (409).
  const next = action === 'delete' ? 'deleted' : action === 'hide' ? 'hidden' : 'published';
  const rows = await run(
    q,
    `UPDATE "ForumPost" p SET status = $1, body = CASE WHEN $1 = 'deleted' THEN '' ELSE p.body END, "updatedAt" = now()
     WHERE p.id = $2::uuid AND p.status = $3
       AND EXISTS (SELECT 1 FROM "ForumThread" t WHERE t.id = p."threadId" AND t."spaceId" = $4::uuid)
     RETURNING p.status`,
    [next, post.id, post.status, spaceId],
  );
  if (!rows.length) throw new ForumError(409, 'post changed concurrently');
  return { postId: post.id, status: rows[0].status };
}
