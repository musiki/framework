import type { APIRoute } from 'astro';
import { canonicalizeCourseId } from '../../../lib/course-alias';
import { json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { normalizeCohortInput } from '../../../lib/cohorts/cohort-labels.mjs';

export const prerender = false;

const clean = (v: unknown) => String(v || '').trim();

/**
 * GET /api/admin/cohorts?courseId=s123
 * Lista las cohortes de una materia, con cuánta gente tiene cada una.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const courseId = await canonicalizeCourseId(clean(url.searchParams.get('courseId')));
  if (!courseId) return json({ error: 'Falta el courseId.' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Sólo docentes de la materia.' }, 403);

  const { data, error } = await query(
    `SELECT c."id", c."label", c."year", c."term", c."isActive", c."createdAt",
            COUNT(e."id") FILTER (WHERE e."roleInCourse" = 'student')  AS "students",
            COUNT(e."id") FILTER (WHERE e."roleInCourse" <> 'student') AS "staff"
       FROM "Cohort" c
       LEFT JOIN "Enrollment" e ON e."cohortId" = c."id"
      WHERE c."courseId" = $1
      GROUP BY c."id"
      ORDER BY c."isActive" DESC, c."year" DESC NULLS LAST, c."label" DESC`,
    [courseId],
  );
  if (error) return json({ error: 'No se pudieron leer las cohortes.' }, 500);

  return json({ courseId, cohorts: data ?? [] });
};

/**
 * POST /api/admin/cohorts
 * Crea una cohorte nueva: lista de estudiantes limpia, docentes arrastrados.
 *
 * Body: { courseId, year?, term?, comision?, label?, activate?, copyTeachers? }
 *
 * Es el botón de «año nuevo», «segundo cuatrimestre» o «comisión 2». Lo que hace
 * y lo que no:
 *   · crea la cohorte y, si activate, la deja como la activa de la materia
 *   · copia las inscripciones de staff de la cohorte que estaba activa
 *   · NO toca las inscripciones viejas: la cohorte anterior queda entera, con su
 *     gente y sus entregas. Esto no archiva ni borra nada
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

  const parsed = normalizeCohortInput({
    ...body,
    courseId: await canonicalizeCourseId(clean(body?.courseId)),
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { courseId, label, year, term, activate, copyTeachers } = parsed.value;

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Sólo docentes de la materia.' }, 403);

  const { data: existing } = await query(
    `SELECT "id" FROM "Cohort" WHERE "courseId" = $1 AND "label" = $2`,
    [courseId, label],
  );
  if (Array.isArray(existing) && existing.length > 0) {
    return json({ error: `Ya existe una cohorte "${label}" en esta materia.` }, 409);
  }

  // Quién está activa hoy: de ahí salen los docentes que se arrastran.
  const { data: activas } = await query(
    `SELECT "id" FROM "Cohort" WHERE "courseId" = $1 AND "isActive" LIMIT 1`,
    [courseId],
  );
  const cohorteAnterior = Array.isArray(activas) && activas[0] ? (activas[0] as any).id : null;

  // Si la copia de docentes falla, la cohorte recién creada se borra antes de
  // reponer la anterior: con la nueva activa, el índice parcial no deja.
  let creadaId: unknown = null;
  try {
    // El índice parcial impide dos activas por materia, así que primero se baja
    // la anterior y recién después se inserta la nueva.
    if (activate && cohorteAnterior) {
      const { error } = await query(
        `UPDATE "Cohort" SET "isActive" = false WHERE "courseId" = $1 AND "isActive"`,
        [courseId],
      );
      if (error) throw error;
    }

    const { data: creada, error: errorCrear } = await query(
      `INSERT INTO "Cohort" ("courseId", "label", "year", "term", "isActive")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING "id", "label", "year", "term", "isActive", "createdAt"`,
      [courseId, label, year, term, activate],
    );
    if (errorCrear) throw errorCrear;

    const cohorte = Array.isArray(creada) ? (creada[0] as any) : null;
    if (!cohorte?.id) throw new Error('La cohorte no devolvió id.');
    creadaId = cohorte.id;

    let docentesCopiados = 0;
    if (copyTeachers && cohorteAnterior) {
      const { data: copiadas, error: errorCopia } = await query(
        `INSERT INTO "Enrollment" ("userId", "courseId", "roleInCourse", "cohortId")
         SELECT DISTINCT e."userId", e."courseId", e."roleInCourse", $1::bigint
           FROM "Enrollment" e
          WHERE e."cohortId" = $2
            AND e."roleInCourse" IS DISTINCT FROM 'student'
            AND e."userId" IS NOT NULL
         RETURNING "id"`,
        [cohorte.id, cohorteAnterior],
      );
      if (errorCopia) throw errorCopia;
      docentesCopiados = Array.isArray(copiadas) ? copiadas.length : 0;
    }

    return json({
      success: true,
      cohort: cohorte,
      previousCohortId: cohorteAnterior,
      staffCopied: docentesCopiados,
    });
  } catch (error: any) {
    console.error('[cohorts] create failed:', error);
    // Si algo falló a mitad de camino, se deshace: fuera la cohorte nueva (sin
    // inscriptos todavía) y de vuelta activa la anterior.
    if (creadaId) {
      await query(`DELETE FROM "Cohort" WHERE "id" = $1`, [creadaId]).catch((e) =>
        console.error('[cohorts] rollback delete failed:', e));
    }
    if (activate && cohorteAnterior) {
      await query(`UPDATE "Cohort" SET "isActive" = true WHERE "id" = $1`, [cohorteAnterior])
        .catch(() => {});
    }
    return json({ error: error?.message || 'No se pudo crear la cohorte.' }, 500);
  }
};
