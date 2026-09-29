// Pure wrapper for the mm HTTP API (`src/pages/api/mm/*`). Every route goes
// through `mmHandler`, which applies, in order:
//   1. tenant check — `/api/mm/*` is reachable from musiki too (routes 'all'),
//      so anything but tenant `mm` gets a JSON 404;
//   2. CSRF on mutations (same rule as studio's assertSameOriginJson);
//   3. the mm commons space (resolved once per request; 404 when not seeded);
//   4. the session user id (401 on writes that need one; reads get null),
//      then a per-user write rate limit on mutations (429);
//   5. the handler, with domain errors (ConceptError/ForumError/MmApiError:
//      numeric `status` 400–409) mapped to their status and anything else
//      logged server-side and returned as a generic 500.
// Dependencies are injected so the wrapper is tested without Astro or a DB
// (`api-core.test.mjs`); `api.ts` binds the real ones.

import { sameOriginJsonRejection } from '../tenant/same-origin.ts';
import { isUuid } from '../tenant/space-roles.ts';
import type { QueryFn } from './concepts-core.ts';
import { createRateLimiter } from './bibliography.ts';
import { clientKey } from './client-key.ts';

export const MM_TENANT_ID = 'mm';
export const MM_SPACE_SLUG = 'mishmash';

export type MmSpace = { id: string; settings: Record<string, unknown> };

export class MmApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MmApiError';
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

const EXPOSED_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 422, 429]);

/** Domain error → its status + message; anything else → logged, generic 500. */
export function errorResponse(err: unknown, tag = 'mm:api'): Response {
  const status = Number((err as { status?: unknown })?.status);
  const name = (err as { name?: unknown })?.name;
  const isDomain =
    err instanceof MmApiError || name === 'ConceptError' || name === 'ForumError' || name === 'MmApiError';
  if (isDomain && EXPOSED_STATUSES.has(status)) {
    return json({ error: String((err as Error).message || 'Request failed') }, status);
  }
  console.error(`[${tag}]`, err);
  return json({ error: 'Internal error' }, 500);
}

export function requireUuidParam(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !isUuid(value)) throw new MmApiError(400, `invalid ${what}`);
  return value;
}

/** Reads a JSON object body; a malformed or non-object body is a 400. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new MmApiError(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MmApiError(400, 'invalid JSON body');
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Write rate limits (per user; per client address when there is no user)
// ---------------------------------------------------------------------------

export type RateBucket = 'write' | 'vote';
export const RATE_LIMITS: Record<RateBucket, Array<{ max: number; windowMs: number }>> = {
  write: [{ max: 30, windowMs: 60_000 }, { max: 300, windowMs: 3_600_000 }],
  vote: [{ max: 120, windowMs: 60_000 }, { max: 1000, windowMs: 3_600_000 }],
};

/** `(bucket, key) => allowed`; every window of the bucket counts the hit. In-process (single node). */
export function createWriteLimiter(now: () => number = Date.now): (bucket: RateBucket, key: string) => boolean {
  const limiters = Object.fromEntries(
    (Object.keys(RATE_LIMITS) as RateBucket[]).map((b) => [b, RATE_LIMITS[b].map((l) => createRateLimiter(l.max, l.windowMs, now))]),
  ) as Record<RateBucket, Array<(key: string) => boolean>>;
  return (bucket, key) => {
    let ok = true;
    for (const allow of limiters[bucket]) if (!allow(key)) ok = false;
    return ok;
  };
}

export type MmDeps = {
  /** The tenant-aware origin mutations must come from (resolveRequestAuthOrigin). */
  expectedOrigin: (request: Request) => string;
  /** The mm commons space, or null when it is not seeded. */
  loadSpace: () => Promise<MmSpace | null>;
  /** The signed-in user's id, or null. */
  loadUserId: (locals: any) => Promise<string | null>;
  q: QueryFn;
  /** Mutation rate limit; see createWriteLimiter. */
  allowWrite: (bucket: RateBucket, key: string) => boolean;
};

export type MmCtx = {
  request: Request;
  url: URL;
  params: Record<string, string | undefined>;
  locals: any;
  /** Adapter client address (fallback rate-limit key for anonymous mutations). */
  clientAddress?: string;
};

export type MmEnv = {
  space: MmSpace;
  /** null for anonymous readers (only when `auth` is not required). */
  userId: string | null;
  q: QueryFn;
};

export type MmHandlerOptions = {
  /** POST/PATCH/PUT/DELETE: CSRF check (+ JSON content-type unless `requireJson: false`). */
  mutation?: boolean;
  requireJson?: boolean;
  /** 401 without a signed-in user (defaults to `mutation`). */
  auth?: boolean;
  /** Log tag for 500s. */
  tag?: string;
  /** Rate-limit bucket for mutations (default 'write'). */
  rateBucket?: RateBucket;
};

export function mmHandler(
  opts: MmHandlerOptions,
  fn: (ctx: MmCtx, env: MmEnv) => Promise<Response>,
  deps: MmDeps,
): (ctx: MmCtx) => Promise<Response> {
  const mutation = opts.mutation === true;
  const requireAuth = opts.auth ?? mutation;
  return async (ctx) => {
    if (ctx.locals?.tenant?.id !== MM_TENANT_ID) return json({ error: 'Not found' }, 404);
    if (mutation) {
      const rejection = sameOriginJsonRejection(ctx.request, deps.expectedOrigin(ctx.request), {
        requireJson: opts.requireJson ?? true,
      });
      if (rejection) return json({ error: rejection.error }, rejection.status);
    }
    try {
      const space = await deps.loadSpace();
      if (!space) return json({ error: 'Not found' }, 404);
      const userId = await deps.loadUserId(ctx.locals);
      if (requireAuth && !userId) return json({ error: 'Not authenticated' }, 401);
      if (mutation) {
        const key = userId ? `u:${userId}` : `ip:${clientKey(ctx.request.headers, ctx.clientAddress)}`;
        if (!deps.allowWrite(opts.rateBucket ?? 'write', key)) {
          return json({ error: 'Too many requests' }, 429, { 'Retry-After': '60' });
        }
      }
      return await fn(ctx, { space, userId, q: deps.q });
    } catch (err) {
      return errorResponse(err, opts.tag);
    }
  };
}

// ---------------------------------------------------------------------------
// Small q-injected lookups used by several routes
// ---------------------------------------------------------------------------

async function rows(q: QueryFn, text: string, params: unknown[]): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw error instanceof Error ? error : new Error(String(error?.message || error));
  return data ?? [];
}

export const SPACE_SQL = `SELECT id, settings FROM "Space"
  WHERE "tenantId" = $1 AND kind = 'commons' AND slug = $2 LIMIT 1`;

export async function loadMmSpace(q: QueryFn): Promise<MmSpace | null> {
  const r = (await rows(q, SPACE_SQL, [MM_TENANT_ID, MM_SPACE_SLUG]))[0];
  if (!r) return null;
  const settings = r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings) ? r.settings : {};
  return { id: r.id, settings };
}

/** Forum id by slug in the space, archived included (for curator updates). */
export async function findForumId(q: QueryFn, spaceId: string, slug: unknown): Promise<string> {
  if (typeof slug !== 'string' || !slug) throw new MmApiError(404, 'forum not found');
  const r = (await rows(q, `SELECT id FROM "ForumBoard" WHERE "spaceId" = $1::uuid AND slug = $2 LIMIT 1`, [spaceId, slug]))[0];
  if (!r) throw new MmApiError(404, 'forum not found');
  return r.id;
}

/** Concept id by slug in the space. */
export async function findConceptId(q: QueryFn, spaceId: string, slug: unknown): Promise<string> {
  if (typeof slug !== 'string' || !slug || slug.length > 200) throw new MmApiError(404, 'concept not found');
  const r = (await rows(q, `SELECT id FROM "Concept" WHERE "spaceId" = $1::uuid AND slug = $2 LIMIT 1`, [spaceId, slug]))[0];
  if (!r) throw new MmApiError(404, 'concept not found');
  return r.id;
}

/** Relation id must belong to the space (else 404, never another space's row). */
export async function assertRelationInSpace(q: QueryFn, spaceId: string, relationId: string): Promise<void> {
  const r = await rows(q, `SELECT 1 FROM "ConceptRelation" WHERE id = $1::uuid AND "spaceId" = $2::uuid LIMIT 1`, [
    relationId, spaceId,
  ]);
  if (!r.length) throw new MmApiError(404, 'relation not found');
}

/**
 * PATCH /concepts/[slug] carries exactly one kind of change: a definition
 * version (`definition` + `lang` [+ `sources`]), a status, or labels.
 */
const PATCH_KEYS = { definition: ['definition', 'lang', 'sources'], status: ['status'], labels: ['label', 'labelNb'] } as const;

export function conceptPatchKind(body: Record<string, unknown>): 'definition' | 'status' | 'labels' {
  const kinds: Array<'definition' | 'status' | 'labels'> = [];
  if ('definition' in body) kinds.push('definition');
  if ('status' in body) kinds.push('status');
  if ('label' in body || 'labelNb' in body) kinds.push('labels');
  if (kinds.length !== 1) throw new MmApiError(400, 'send exactly one of: definition, status, label/labelNb');
  const allowed: readonly string[] = PATCH_KEYS[kinds[0]];
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new MmApiError(400, `unexpected field: ${extra[0].slice(0, 40)}`);
  return kinds[0];
}

/** Languages the API writes: English (source) and hand-written Bokmål. Nynorsk is a UI fallback only. */
export const API_LANGS = ['en', 'nb'] as const;
export function apiLang(raw: unknown): 'en' | 'nb' {
  if (raw === undefined || raw === null || raw === '') return 'en';
  if (raw === 'en' || raw === 'nb') return raw;
  throw new MmApiError(400, 'lang must be en or nb');
}
