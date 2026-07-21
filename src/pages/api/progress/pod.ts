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

const C4_LEVEL: Record<string, number> = { 'mini-c': 1, 'little-c': 2, 'pro-c': 3, 'big-c': 4 };
const REQUIRED = { proyecto: 1, conexiones: 5, coloquios: 2, estigmergia: 1, aporte: 1 };

function humanizeUnit(value: string): string {
  const clean = String(value || '')
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Recorrido';
}

function unitForNode(nodeId: string, courseId: string): { id: string; label: string; order: number } {
  const parts = String(nodeId || '').split('/').filter(Boolean);
  const courseIndex = parts.findIndex((part) => part === courseId);
  const relative = courseIndex >= 0 ? parts.slice(courseIndex + 1) : parts;
  const unitId = relative.length > 1 ? relative[0] : 'recorrido';
  const orderMatch = unitId.match(/^(\d+)/);
  return {
    id: unitId,
    label: humanizeUnit(unitId),
    order: orderMatch ? Number(orderMatch[1]) : 999,
  };
}

function conceptHref(courseId: string, slug: string): string {
  return `/${encodeURIComponent(courseId)}/${encodeURIComponent(slug)}`;
}

function courseRelativePath(nodeId: string, courseId: string, fallback: string): string {
  const parts = String(nodeId || '').split('/').filter(Boolean);
  const courseIndex = parts.findIndex((part) => part === courseId);
  const relative = courseIndex >= 0 ? parts.slice(courseIndex + 1).join('/') : '';
  return relative || fallback;
}

/**
 * GET /api/progress/pod?courseId=<id>
 * Payload del pod de la cátedra-recorrido para el curso activo:
 *  - concepts: estado (completado/evaluado) + logros por concepto (conns/coloquio/peer/aporte).
 *  - edges: relaciones canónicas concepto↔concepto del curso.
 *  - rubric: conteo de logros vs. REQUIRED; project: nivel 4C.
 * Clasifica cada Submission por el `evalType` del catálogo.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const currentUser = session?.user;
  if (!currentUser?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = String(url.searchParams.get('courseId') || '').trim();
  if (!courseId) return json({ error: 'courseId required' }, 400);

  try {
    const graph = buildGraphData({ publicOnly: false }) as { nodes: Array<any>; links: Array<any> };
    const courseNodes = graph.nodes.filter((n) => n?.type === 'document' && n?.course === courseId);
    if (courseNodes.length === 0) {
      return json({
        courseId, concepts: [], edges: [], project: { c4Level: 0 },
        rubric: { proyecto: 0, conexiones: 0, coloquios: 0, estigmergia: 0, aporte: 0 },
        required: REQUIRED, totals: { concepts: 0, completed: 0, evaluated: 0 },
        daily: { total: 0, items: [] },
      });
    }

    const idSet = new Set(courseNodes.map((n) => n.id));
    const concepts = new Map<string, any>();
    for (const n of courseNodes) {
      const unit = unitForNode(n.id, courseId);
      const slug = n.canonicalSlug || normSeg(n.id);
      concepts.set(n.id, {
        id: n.id,
        slug,
        href: conceptHref(courseId, slug),
        pageSlug: courseRelativePath(n.id, courseId, slug),
        name: n.name || '',
        def: n.def || '',
        status: n.status || '',
        unitId: unit.id,
        unitLabel: unit.label,
        unitOrder: unit.order,
        read: false,
        completed: false,
        evaluated: false,
        submissions: 0,
        conns: 0,
        coloquio: false,
        peer: false,
        aporte: false,
      });
    }

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

    const rubric = { proyecto: 0, conexiones: 0, coloquios: 0, estigmergia: 0, aporte: 0 };
    let projectC4 = 0;
    let daily = { total: 0, items: [] as Array<Record<string, unknown>> };

    const { data: userRows } = await query(
      'SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1',
      [currentUser.email],
    );
    const userId = userRows?.[0]?.id;

    if (userId) {
      const [{ data: submissions }, catalog] = await Promise.all([
        query(
          `SELECT "assignmentId", "payload" FROM "Submission" WHERE "userId" = $1`,
          [userId],
        ),
        buildEvalCatalog(),
      ]);

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

        const type = String(entry.evalType || '');
        const payload = sub?.payload && typeof sub.payload === 'object' ? sub.payload : {};
        const answer = (payload?.answer && typeof payload.answer === 'object') ? payload.answer : {};

        // Logros de curso (no exigen coincidir con un nodo concepto).
        if (type === 'proyecto') {
          rubric.proyecto += 1;
          const lvl = C4_LEVEL[String(answer?.c4Target || answer?.c4 || '').toLowerCase()] || 0;
          if (lvl > projectC4) projectC4 = lvl;
        } else if (type === 'conexion') {
          rubric.conexiones += 1;
        } else if (type === 'coloquio') {
          rubric.coloquios += 1;
        } else if (type === 'peer_rubric') {
          rubric.estigmergia += 1;
        } else if (type === 'short_ai' || type === 'essay_ai' || type === 'reference_ai') {
          rubric.aporte += 1;
        }

        // Estado + logro a nivel concepto (por la nota donde vive el bloque).
        const seg = normSeg(entry.entryId || entry.sourcePath || evalId);
        const rec = bySeg.get(seg);
        if (!rec) continue;
        rec.submissions += 1;
        rec.read = true;

        const completedFlag =
          payload?.completed === true ||
          (answer && typeof answer === 'object' && (answer as any).completed === true);

        switch (type) {
          case 'mcc': if (completedFlag) rec.completed = true; break;
          case 'conexion': rec.conns += 1; rec.completed = true; break;
          case 'coloquio': rec.coloquio = true; rec.evaluated = true; break;
          case 'peer_rubric': rec.peer = true; rec.evaluated = true; break;
          case 'proyecto': rec.evaluated = true; break;
          case 'short_ai': case 'essay_ai': case 'reference_ai': rec.aporte = true; rec.evaluated = true; break;
          default: rec.evaluated = true; // mcq, msq, combinatoria, poll, wordcloud, patch_ai…
        }
      }

      // La cola diaria usa el scheduler SM-2 ya existente. Es un side-channel:
      // una tabla SRS aún no migrada no debe impedir que el alumno vea el POD.
      try {
        const { data: dueRows } = await query(
          `SELECT "evalId", "deck", "reps", "intervalDays", "dueAt", "lastReviewedAt"
           FROM "SrsState"
           WHERE "userId" = $1 AND "dueAt" <= now()
           ORDER BY "dueAt" ASC
           LIMIT 200`,
          [userId],
        );
        const items = (dueRows || []).flatMap((row: Record<string, unknown>) => {
          const evalId = String(row.evalId || '');
          const entry = (catalog.get(evalId) || []).find((candidate) => candidate.courseId === courseId);
          if (!entry) return [];
          const slug = normSeg(entry.entryId || entry.sourcePath || evalId);
          return [{
            evalId,
            title: entry.entryTitle || entry.prompt || evalId,
            prompt: entry.prompt || '',
            deck: row.deck || 'default',
            reps: Number(row.reps) || 0,
            intervalDays: Number(row.intervalDays) || 0,
            dueAt: row.dueAt,
            lastReviewedAt: row.lastReviewedAt ?? null,
            href: `${conceptHref(courseId, slug)}#eval-${encodeURIComponent(evalId)}`,
          }];
        });
        daily = { total: items.length, items: items.slice(0, 12) };
      } catch (srsError: any) {
        console.warn('[progress/pod] SRS queue unavailable:', srsError?.message || srsError);
      }
    }

    const list = [...concepts.values()].sort((a, b) =>
      (a.unitOrder - b.unitOrder)
      || String(a.unitLabel).localeCompare(String(b.unitLabel), 'es')
      || String(a.name).localeCompare(String(b.name), 'es'));
    return json({
      courseId,
      concepts: list,
      edges,
      project: { c4Level: projectC4 },
      rubric,
      required: REQUIRED,
      daily,
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
