import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ensureDbUserFromSession, getForumCourseAccess, json } from '../../../lib/forum-server';
import { isElevatedGlobalRole } from '../../../lib/roles';
import {
  claimOrChangeRecipient,
  getAmigxCriticxPortalState,
  releaseRecipientClaim,
  setAmigxCriticxPublicToggle,
  submitAmigxCriticxReport,
  submitRecipientResponse,
} from '../../../lib/amigx-criticx/service';

export const prerender = false;

const TARGET_COURSE_ID = 's123';

async function resolveAuthenticatedActor(request: Request) {
  const session = await getSession(request);
  if (!session?.user?.email) {
    return { errorResponse: json({ error: 'Sesión requerida' }, 401), actor: null };
  }

  const dbUser = await ensureDbUserFromSession(session);
  if (!dbUser) {
    return { errorResponse: json({ error: 'Usuario no encontrado en Musiki' }, 403), actor: null };
  }

  const courseAccess = await getForumCourseAccess(dbUser, TARGET_COURSE_ID);
  const isTeacher = Boolean(courseAccess.isTeacher || isElevatedGlobalRole(dbUser.role));
  const isEnrolled = Boolean(courseAccess.isEnrolled || isTeacher);

  if (!isEnrolled) {
    return {
      errorResponse: json(
        { error: 'Debés estar inscriptx en Seminarios (s123) para usar el portal de Amigx Críticx.' },
        403,
      ),
      actor: null,
    };
  }

  return {
    errorResponse: null,
    actor: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      isTeacher,
    },
  };
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const { errorResponse, actor } = await resolveAuthenticatedActor(request);
    if (errorResponse || !actor) return errorResponse!;

    const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
    return json({ ok: true, state });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al cargar el portal de Amigx Críticx';
    console.error('[api/amigx-criticx GET]', error);
    return json({ error: message }, 500);
  }
};

interface PostPayload {
  action?: string;
  recipientUserId?: string;
  descripcion?: string;
  funcionaNoFunciona?: string;
  hariaDistinto?: string;
  isPublic?: boolean;
  reviewId?: string;
  recipientResponse?: string;
  targetAuthorUserId?: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { errorResponse, actor } = await resolveAuthenticatedActor(request);
    if (errorResponse || !actor) return errorResponse!;

    const body = (await request.json().catch(() => ({}))) as PostPayload;
    const action = String(body.action || '').trim();

    if (action === 'select_recipient') {
      const recipientUserId = String(body.recipientUserId || '').trim();
      const result = await claimOrChangeRecipient({
        courseId: TARGET_COURSE_ID,
        authorUserId: actor.id,
        recipientUserId,
      });
      if (!result.ok) {
        return json({ error: result.message }, result.status);
      }
      const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
      return json({ ok: true, state });
    }

    if (action === 'submit_review') {
      const recipientUserId = String(body.recipientUserId || '').trim();
      const descripcion = String(body.descripcion ?? '');
      const funcionaNoFunciona = String(body.funcionaNoFunciona ?? '');
      const hariaDistinto = String(body.hariaDistinto ?? '');
      const isPublic = Boolean(body.isPublic);

      const result = await submitAmigxCriticxReport({
        courseId: TARGET_COURSE_ID,
        authorUserId: actor.id,
        recipientUserId,
        descripcion,
        funcionaNoFunciona,
        hariaDistinto,
        isPublic,
      });
      if (!result.ok) {
        return json({ error: result.message }, result.status);
      }
      const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
      return json({ ok: true, state });
    }

    if (action === 'toggle_public') {
      const isPublic = Boolean(body.isPublic);
      const result = await setAmigxCriticxPublicToggle({
        courseId: TARGET_COURSE_ID,
        authorUserId: actor.id,
        isPublic,
      });
      if (!result.ok) {
        return json({ error: result.message || 'No se pudo actualizar la visibilidad' }, 400);
      }
      const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
      return json({ ok: true, state });
    }

    if (action === 'submit_response') {
      const reviewId = String(body.reviewId || '').trim();
      const recipientResponse = String(body.recipientResponse ?? '');
      const result = await submitRecipientResponse({
        courseId: TARGET_COURSE_ID,
        recipientUserId: actor.id,
        reviewId,
        recipientResponse,
      });
      if (!result.ok) {
        return json({ error: result.message }, result.status);
      }
      const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
      return json({ ok: true, state });
    }

    if (action === 'release_recipient') {
      const targetAuthorUserId = body.targetAuthorUserId ? String(body.targetAuthorUserId).trim() : undefined;
      const result = await releaseRecipientClaim({
        courseId: TARGET_COURSE_ID,
        actorUserId: actor.id,
        isTeacher: actor.isTeacher,
        targetAuthorUserId,
      });
      if (!result.ok) {
        return json({ error: result.message }, result.status);
      }
      const state = await getAmigxCriticxPortalState(TARGET_COURSE_ID, actor);
      return json({ ok: true, state });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al procesar la solicitud de Amigx Críticx';
    console.error('[api/amigx-criticx POST]', error);
    return json({ error: message }, 500);
  }
};
