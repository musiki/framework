// Pure handlers of the relation modeler API (spec "API"): relation types,
// the relation view, stances, settling, deletion and the graph. Each handler
// has the `mmHandler` shape `(ctx, env) => Response`; the cores are injected
// so the handlers are tested without Astro or a database
// (`relation-api-core.test.mjs`), and `relation-api.ts` binds the real ones.
// Routes pass `RELATION_ROUTES.<name>` as the mmRoute options, so the tenant
// check, CSRF, auth and the rate-limit bucket are part of what is tested.
//
// Privacy: handlers return what the cores return, never more. The relation
// view carries names only when the core put them there (revealed + member,
// enforced in SQL); nothing here adds a user id, an e-mail or a stance holder.

import { json, readJsonObject, requireUuidParam, apiLang, MmApiError, type MmCtx, type MmEnv, type MmHandlerOptions } from './api-core.ts';
import { RELATION_TYPE_FIELD_KEYS, type RelationTypeDetail, type RelationTypeView } from './relation-types-core.ts';
import type { RelationView, Stance } from './stances-core.ts';
import type { GraphPayload } from './relations-core.ts';
import type { MmLang } from './ui-lang.ts';
import type { ViewLang } from './view.ts';

export type RelationApiCores = {
  listRelationTypes: (a: { spaceId: string; includeArchived?: boolean }) => Promise<RelationTypeView[]>;
  getRelationType: (a: { spaceId: string; slug: string; viewerUserId?: string | null; lang?: MmLang }) => Promise<RelationTypeDetail | null>;
  createRelationType: (a: {
    spaceId: string; actorUserId: string | null; type: unknown; slug?: unknown; definition: unknown;
    definitionNb?: unknown; sources?: unknown; forumId?: string | null;
  }) => Promise<unknown>;
  updateRelationType: (a: { spaceId: string; slug: string; actorUserId: string | null; patch: unknown }) => Promise<unknown>;
  archiveRelationType: (a: { spaceId: string; slug: string; actorUserId: string | null; archived?: boolean }) => Promise<unknown>;
  reorderRelationTypes: (a: { spaceId: string; actorUserId: string | null; slugs: unknown }) => Promise<unknown>;
  editDefinition: (a: { conceptId: string; actorUserId: string | null; lang: unknown; definition: unknown; sources?: unknown }) => Promise<unknown>;
  getForumRef: (a: { spaceId: string; ref: unknown }) => Promise<{ id: string } | null>;
  getRelationView: (a: { relationId: string; spaceId: string; viewerUserId?: string | null }) => Promise<RelationView | null>;
  setStance: (a: { relationId: string; spaceId: string; actorUserId: string | null; stance: unknown }) => Promise<{ stance: Stance | null; afterReveal: boolean }>;
  settleRelation: (a: { relationId: string; spaceId: string; actorUserId: string | null }) => Promise<unknown>;
  deleteRelation: (a: { relationId: string; spaceId: string; actorUserId: string | null }) => Promise<unknown>;
  graph: (a: { spaceId: string; forumId: string | null; status: string | null; lang: ViewLang }) => Promise<GraphPayload>;
};

/** mmRoute options per handler (the routes use exactly these). */
export const RELATION_ROUTES = {
  listTypes: { tag: 'mm:relation-types' },
  createType: { mutation: true, tag: 'mm:relation-types' },
  reorderTypes: { mutation: true, tag: 'mm:relation-types' },
  getType: { tag: 'mm:relation-type' },
  patchType: { mutation: true, tag: 'mm:relation-type' },
  getRelation: { tag: 'mm:relation' },
  deleteRelation: { mutation: true, requireJson: false, tag: 'mm:relation' },
  // Stances count as votes: the looser, separate bucket (clicking agree/disagree back and forth).
  stance: { mutation: true, rateBucket: 'vote', tag: 'mm:stance' },
  // A body-less POST: CSRF (origin) is still checked, a JSON content type is not required.
  settle: { mutation: true, requireJson: false, tag: 'mm:settle' },
  graph: { tag: 'mm:graph' },
} as const satisfies Record<string, MmHandlerOptions>;

const TYPE_CREATE_KEYS = new Set([...RELATION_TYPE_FIELD_KEYS, 'slug', 'definition', 'definitionNb', 'sources', 'forum']);
const TYPE_FIELD_KEYS = new Set(RELATION_TYPE_FIELD_KEYS);
const DEFINITION_KEYS = new Set(['definition', 'lang', 'sources']);

function rejectExtra(body: Record<string, unknown>, allowed: Set<string>): void {
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) throw new MmApiError(400, `unexpected field: ${extra[0].slice(0, 40)}`);
}

function pick(body: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => keys.has(k)));
}

/**
 * PATCH /relation-types/[slug] carries exactly one kind of change: a
 * definition version (`definition` + `lang` [+ `sources`]), `archived`
 * (true archives, false restores), or type fields (labels, encoding,
 * properties, mappings). The slug never changes.
 */
export function relationTypePatchKind(body: Record<string, unknown>): 'definition' | 'archive' | 'fields' {
  const kinds: Array<'definition' | 'archive' | 'fields'> = [];
  if ('definition' in body) kinds.push('definition');
  if ('archived' in body) kinds.push('archive');
  if (Object.keys(body).some((k) => TYPE_FIELD_KEYS.has(k))) kinds.push('fields');
  if (kinds.length !== 1) throw new MmApiError(400, 'send exactly one of: definition, archived, or type fields');
  if (kinds[0] === 'definition') rejectExtra(body, DEFINITION_KEYS);
  else if (kinds[0] === 'archive') {
    rejectExtra(body, new Set(['archived']));
    if (typeof body.archived !== 'boolean') throw new MmApiError(400, 'archived must be true or false');
  } else rejectExtra(body, TYPE_FIELD_KEYS);
  return kinds[0];
}

const viewLang = (raw: string | null): ViewLang => (raw === 'nb' || raw === 'nn' ? raw : 'en');
/** Citation locale of rendered definitions: Nynorsk readers get Bokmål citations. */
const citeLang = (raw: string | null): MmLang => (raw === 'nb' || raw === 'nn' ? 'nb' : 'en');
const slugParam = (ctx: MmCtx): string => String(ctx.params.slug || '');

/** The type's definition concept without the space id (like the concept API). */
function publicType(t: RelationTypeDetail): RelationTypeDetail {
  if (!t.concept) return t;
  const { spaceId: _spaceId, ...concept } = t.concept;
  return { ...t, concept: concept as RelationTypeDetail['concept'] };
}

export function relationApi(c: RelationApiCores) {
  return {
    // GET /api/mm/relation-types — public; ?archived=1 includes archived types.
    listTypes: async ({ url }: MmCtx, { space }: MmEnv) => {
      const includeArchived = url.searchParams.get('archived') === '1';
      return json({ relationTypes: await c.listRelationTypes({ spaceId: space.id, includeArchived }) });
    },

    // POST /api/mm/relation-types — curators/admins:
    // { label, labelNb?, inverseLabel?, inverseLabelNb?, render?, stroke?, arrow?, color?, symmetric?, transitive?,
    //   hierarchical?, skos?, wikidata?, slug?, definition, definitionNb?, sources?, forum? }.
    createType: async ({ request }: MmCtx, { space, userId }: MmEnv) => {
      const body = await readJsonObject(request);
      rejectExtra(body, TYPE_CREATE_KEYS);
      let forumId: string | null = null;
      if (body.forum !== undefined && body.forum !== null && body.forum !== '') {
        const forum = await c.getForumRef({ spaceId: space.id, ref: body.forum });
        if (!forum) throw new MmApiError(404, 'forum not found');
        forumId = forum.id;
      }
      const created = await c.createRelationType({
        spaceId: space.id, actorUserId: userId, type: pick(body, TYPE_FIELD_KEYS), slug: body.slug,
        definition: body.definition, definitionNb: body.definitionNb, sources: body.sources, forumId,
      });
      return json(created, 201);
    },

    // PUT /api/mm/relation-types — curators/admins: { slugs: [...] } (legend order).
    reorderTypes: async ({ request }: MmCtx, { space, userId }: MmEnv) => {
      const body = await readJsonObject(request);
      rejectExtra(body, new Set(['slugs']));
      return json(await c.reorderRelationTypes({ spaceId: space.id, actorUserId: userId, slugs: body.slugs }));
    },

    // GET /api/mm/relation-types/[slug] — public; archived types too. ?lang=en|nb|nn (citation locale).
    getType: async (ctx: MmCtx, { space, userId }: MmEnv) => {
      const t = await c.getRelationType({ spaceId: space.id, slug: slugParam(ctx), viewerUserId: userId, lang: citeLang(ctx.url.searchParams.get('lang')) });
      if (!t) return json({ error: 'Not found' }, 404);
      return json({ relationType: publicType(t) });
    },

    // PATCH /api/mm/relation-types/[slug] — curators/admins; see relationTypePatchKind.
    patchType: async (ctx: MmCtx, { space, userId }: MmEnv) => {
      const body = await readJsonObject(ctx.request);
      const kind = relationTypePatchKind(body);
      const slug = slugParam(ctx);
      if (kind === 'archive') {
        return json(await c.archiveRelationType({ spaceId: space.id, slug, actorUserId: userId, archived: body.archived as boolean }));
      }
      if (kind === 'fields') return json(await c.updateRelationType({ spaceId: space.id, slug, actorUserId: userId, patch: body }));
      // The definition concept is reached through the type — the concept API never sees kind 'relation-type'.
      const t = await c.getRelationType({ spaceId: space.id, slug });
      if (!t || !t.concept) throw new MmApiError(404, 'relation type not found');
      return json(await c.editDefinition({
        conceptId: t.concept.id, actorUserId: userId, lang: apiLang(body.lang), definition: body.definition, sources: body.sources,
      }));
    },

    // GET /api/mm/relations/[id] — public: totals, own stance, reveal date; names only once revealed, to members.
    getRelation: async ({ params }: MmCtx, { space, userId }: MmEnv) => {
      const relationId = requireUuidParam(params.id, 'relation id');
      const relation = await c.getRelationView({ relationId, spaceId: space.id, viewerUserId: userId });
      if (!relation) return json({ error: 'Not found' }, 404);
      return json({ relation });
    },

    // DELETE /api/mm/relations/[id] — curators/admins any; members their own while unsettled and nobody else took a stance.
    deleteRelation: async ({ params }: MmCtx, { space, userId }: MmEnv) => {
      const relationId = requireUuidParam(params.id, 'relation id');
      return json(await c.deleteRelation({ relationId, spaceId: space.id, actorUserId: userId }));
    },

    // POST /api/mm/relations/[id]/stance — { stance: 'agree' | 'disagree' | null }. Setting: members+;
    // null withdraws the caller's own stance (any signed-in user). Returns the caller's stance and the
    // relation view as the caller may see it (no names while blind).
    stance: async ({ request, params }: MmCtx, { space, userId }: MmEnv) => {
      const relationId = requireUuidParam(params.id, 'relation id');
      const body = await readJsonObject(request);
      rejectExtra(body, new Set(['stance']));
      if (!('stance' in body)) throw new MmApiError(400, 'stance must be agree, disagree or null');
      const result = await c.setStance({ relationId, spaceId: space.id, actorUserId: userId, stance: body.stance });
      const relation = await c.getRelationView({ relationId, spaceId: space.id, viewerUserId: userId });
      return json({ stance: result.stance, afterReveal: result.afterReveal, relation });
    },

    // POST /api/mm/relations/[id]/settle — curators/admins: closes the discussion, reveals the stances to members.
    settle: async ({ params }: MmCtx, { space, userId }: MmEnv) => {
      const relationId = requireUuidParam(params.id, 'relation id');
      return json(await c.settleRelation({ relationId, spaceId: space.id, actorUserId: userId }));
    },

    // GET /api/mm/graph — public: { nodes, edges, relationTypes }; ?forum=<group slug | forum id>&status=&lang=en|nb|nn.
    graph: async ({ url }: MmCtx, { space }: MmEnv) => {
      const lang = viewLang(url.searchParams.get('lang'));
      const forumRef = url.searchParams.get('forum');
      let forumId: string | null = null;
      if (forumRef) {
        const forum = await c.getForumRef({ spaceId: space.id, ref: forumRef });
        if (!forum) {
          // Same legend as graph(): archived types only while relations use them.
          const all = await c.listRelationTypes({ spaceId: space.id, includeArchived: true });
          return json({ nodes: [], edges: [], relationTypes: all.filter((t) => !t.isArchived || t.relationCount > 0) });
        }
        forumId = forum.id;
      }
      return json(await c.graph({ spaceId: space.id, forumId, status: url.searchParams.get('status') || null, lang }));
    },
  };
}
