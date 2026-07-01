import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { buildEvalCatalog } from '../../../lib/eval-catalog';
import { buildGraphData } from '../../../scripts/build-graph-data.mjs';

export const prerender = false;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Normalize a slug/path down to a comparable last segment.
const normSeg = (value: string): string =>
  String(value || '')
    .split('/')
    .filter(Boolean)
    .pop()!
    .replace(/\.(md|mdx)$/i, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * GET /api/progress/pod?courseId=<id>
 *
 * Composes the progress pod payload for the active course:
 *  - concepts: one record per document node of the course, with server-authoritative
 *    `completed` (MCC) and `evaluated` (any non-mcc submission). `read` is client-side.
 *  - edges: canonical concept-to-concept relations (connect/hyper/hypo + wikilinks),
 *    restricted to concepts of the course. The client lights an edge when both
 *    endpoints reach state >= completed (connectome density).
 *
 * Achievement tallies (connections authored, coloquio, peer, aporte, project 4C)
 * are NOT emitted yet: they depend on eval types still to be implemented
 * (see docs/evaluation/catedra-recorrido.md §6).
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = String(url.searchParams.get('courseId') || '').trim();
  if (!courseId) return json({ error: 'courseId required' }, 400);

  try {
    // 1) Canonical graph restricted to this course's document nodes.
    const graph = buildGraphData({ publicOnly: false }) as {
      nodes: Array<any>;
      links: Array<any>;
    };
    const courseNodes = graph.nodes.filter(
      (n) => n?.type === 'document' && n?.course === courseId,
    );
    if (courseNodes.length === 0) {
      return json({ courseId, concepts: [], edges: [], totals: { concepts: 0, completed: 0, evaluated: 0 } });
    }

    const idSet = new Set(courseNodes.map((n) => n.id));
    const concepts = new Map<string, any>();
    for (const n of courseNodes) {
      concepts.set(n.id, {
        id: n.id,
        slug: n.canonicalSlug || normSeg(n.id),
        name: n.name || '',
        def: n.def || '',
        status: n.status || '',
        completed: false,
        evaluated: false,
        submissions: 0,
      });
    }

    // Concept-to-concept edges within the course (drop tag edges).
    const edgeSet = new Set<string>();
    const edges: Array<{ source: string; target: string; type: string }> = [];
    for (const l of graph.links) {
      if (l?.type === 'tag') continue;
      if (!idSet.has(l.source) || !idSet.has(l.target)) continue;
      const key = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: l.source, target: l.target, type: l.type || 'link' });
    }

    // 2) Progress from submissions joined with the eval catalog.
    const { data: userRows } = await query(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1',
      [currentUser.email],
    );
    const userId = userRows?.[0]?.id;

    if (userId) {
      const { data: submissions } = await query(
        `SELECT "assignmentId", "payload" FROM "Submission" WHERE "userId" = $1`,
        [userId],
      );
      const catalog = await buildEvalCatalog();

      // Index concepts by normalized last segment for fuzzy joining to catalog notes.
      const bySeg = new Map<string, any>();
      for (const c of concepts.values()) {
        bySeg.set(normSeg(c.id), c);
        if (c.slug) bySeg.set(c.slug, c);
      }

      for (const sub of submissions || []) {
        const evalId = String(sub?.assignmentId || '');
        if (!evalId) continue;
        const entry = catalog.get(evalId)?.[0];
        if (!entry) continue;
        if (entry.courseId && entry.courseId !== courseId) continue;

        const seg = normSeg(entry.entryId || entry.sourcePath || evalId);
        const rec = bySeg.get(seg);
        if (!rec) continue;

        rec.submissions += 1;
        const payload = sub?.payload && typeof sub.payload === 'object' ? sub.payload : {};
        const isMcc = entry.evalType === 'mcc';
        const completedFlag =
          payload?.completed === true ||
          (payload?.answer && typeof payload.answer === 'object' && payload.answer.completed === true);
        if (isMcc) {
          if (completedFlag) rec.completed = true;
        } else {
          rec.evaluated = true;
        }
      }
    }

    const list = [...concepts.values()];
    return json({
      courseId,
      concepts: list,
      edges,
      totals: {
        concepts: list.length,
        completed: list.filter((c) => c.completed).length,
        evaluated: list.filter((c) => c.evaluated).length,
      },
    });
  } catch (error: any) {
    console.error('[progress/pod] error:', error?.message || error);
    return json({ error: error?.message || 'pod progress error' }, 500);
  }
};
