import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { normalizeStops } from '../../../lib/itinerary/itinerary.mjs';

export const prerender = false;

const clean = (v: unknown) => String(v ?? '').trim();
const toId = (v: unknown) => (/^\d{1,18}$/.test(clean(v)) ? clean(v) : '');

type CohortRow = { id: string; label: string; isActive: boolean; stopCount: number };
type ItineraryRow = { stops: unknown[]; version: number; updatedAt: string };

async function readItinerary(cohortId: string): Promise<ItineraryRow | null> {
  const { data, error } = await query(
    `SELECT "stops", "version", "updatedAt" FROM "Itinerary" WHERE "cohortId" = $1`,
    [cohortId],
  );
  if (error) throw error;
  return Array.isArray(data) && data[0] ? (data[0] as ItineraryRow) : null;
}

async function cohortOfCourse(cohortId: string, courseId: string): Promise<boolean> {
  const { data } = await query(`SELECT 1 FROM "Cohort" WHERE "id" = $1 AND "courseId" = $2`, [cohortId, courseId]);
  return Array.isArray(data) && data.length > 0;
}

/**
 * GET /api/progress/itinerary?courseId=s123[&cohortId=7]
 * El itinerario de la cohorte activa (o de la pedida, sólo docentes). Lo leen
 * docentes e inscriptos; las demás cohortes las ve sólo el docente.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const courseId = await canonicalizeCourseId(clean(url.searchParams.get('courseId')));
  if (!courseId) return json({ error: 'Falta el courseId.' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage && !access.enrollmentRole) return json({ error: 'No estás en esta materia.' }, 403);

  const { data, error } = await query(
    `SELECT c."id"::text AS "id", c."label", c."isActive",
            COALESCE(jsonb_array_length(i."stops"), 0) AS "stopCount"
       FROM "Cohort" c
       LEFT JOIN "Itinerary" i ON i."cohortId" = c."id"
      WHERE c."courseId" = $1
      ORDER BY c."isActive" DESC, c."year" DESC NULLS LAST, c."createdAt" DESC`,
    [courseId],
  );
  if (error) return json({ error: 'No se pudieron leer las cohortes.' }, 500);

  const all = (Array.isArray(data) ? data : []) as CohortRow[];
  const cohorts = access.canManage ? all : all.filter((c) => c.isActive);
  const requested = access.canManage ? toId(url.searchParams.get('cohortId')) : '';
  const cohort = cohorts.find((c) => c.id === requested) ?? cohorts.find((c) => c.isActive) ?? null;

  try {
    const itinerary = cohort ? await readItinerary(cohort.id) : null;
    return json({ courseId, canEdit: access.canManage, cohort, cohorts, itinerary });
  } catch {
    return json({ error: 'No se pudo leer el itinerario.' }, 500);
  }
};

/**
 * PUT /api/progress/itinerary
 * Body: { courseId, cohortId, version, stops }. Reemplaza la lista entera.
 * version es la que el cliente leyó (0 si no había itinerario): si otro guardó
 * en el medio, 409 con lo que hay ahora, para no pisarlo.
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const courseId = await canonicalizeCourseId(clean(body?.courseId));
  const cohortId = toId(body?.cohortId);
  const version = Number.isInteger(body?.version) && body.version >= 0 ? body.version : -1;
  if (!courseId || !cohortId || version < 0) return json({ error: 'Faltan courseId, cohortId o version.' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Sólo docentes de la materia.' }, 403);
  if (!(await cohortOfCourse(cohortId, courseId))) return json({ error: 'La cohorte no es de esta materia.' }, 404);

  const parsed = normalizeStops(body?.stops);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const stops = JSON.stringify(parsed.stops);
  const updatedBy = access.userId || null;

  const { data, error } = version === 0
    ? await query(
        `INSERT INTO "Itinerary" ("cohortId", "courseId", "stops", "updatedBy")
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT ("cohortId") DO NOTHING
         RETURNING "stops", "version", "updatedAt"`,
        [cohortId, courseId, stops, updatedBy],
      )
    : await query(
        `UPDATE "Itinerary"
            SET "stops" = $2::jsonb, "version" = "version" + 1, "updatedAt" = now(), "updatedBy" = $3
          WHERE "cohortId" = $1 AND "version" = $4
         RETURNING "stops", "version", "updatedAt"`,
        [cohortId, stops, updatedBy, version],
      );
  if (error) return json({ error: 'No se pudo guardar el itinerario.' }, 500);

  const saved = Array.isArray(data) && data[0] ? (data[0] as ItineraryRow) : null;
  if (saved) return json({ success: true, itinerary: saved });

  const current = await readItinerary(cohortId).catch(() => null);
  return json({ error: 'Alguien guardó el itinerario mientras lo editabas.', itinerary: current }, 409);
};

/**
 * POST /api/progress/itinerary
 * Body: { courseId, fromCohortId, toCohortId }. Duplica el itinerario de una
 * cohorte en otra de la misma materia, sólo si la de destino no tiene paradas.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const courseId = await canonicalizeCourseId(clean(body?.courseId));
  const fromCohortId = toId(body?.fromCohortId);
  const toCohortId = toId(body?.toCohortId);
  if (!courseId || !fromCohortId || !toCohortId || fromCohortId === toCohortId) {
    return json({ error: 'Faltan courseId, fromCohortId o toCohortId.' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Sólo docentes de la materia.' }, 403);
  if (!(await cohortOfCourse(fromCohortId, courseId)) || !(await cohortOfCourse(toCohortId, courseId))) {
    return json({ error: 'Las cohortes no son de esta materia.' }, 404);
  }

  const { data, error } = await query(
    `INSERT INTO "Itinerary" ("cohortId", "courseId", "stops", "updatedBy")
     SELECT $2, "courseId", "stops", $3 FROM "Itinerary" WHERE "cohortId" = $1
     ON CONFLICT ("cohortId") DO UPDATE
        SET "stops" = EXCLUDED."stops", "version" = "Itinerary"."version" + 1,
            "updatedAt" = now(), "updatedBy" = EXCLUDED."updatedBy"
      WHERE jsonb_array_length("Itinerary"."stops") = 0
     RETURNING "stops", "version", "updatedAt"`,
    [fromCohortId, toCohortId, access.userId || null],
  );
  if (error) return json({ error: 'No se pudo duplicar el itinerario.' }, 500);

  const saved = Array.isArray(data) && data[0] ? (data[0] as ItineraryRow) : null;
  if (saved) return json({ success: true, itinerary: saved });
  return json({ error: 'La cohorte de origen no tiene itinerario, o la de destino ya tiene paradas.' }, 409);
};
