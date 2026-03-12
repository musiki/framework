import type { APIRoute } from 'astro';
import { createSupabaseServerClient, json } from '../../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../../lib/live/access';
import {
  deleteDashboardAnnotation,
  getDashboardAnnotationById,
  updateDashboardAnnotation,
} from '../../../../lib/dashboard/annotation-store';
import { normalizeDashboardAnnotationVisibility } from '../../../../lib/dashboard/annotations';

const cleanString = (value: unknown, maxLength = 240) =>
  String(value || '').trim().slice(0, maxLength);

const isMissingRelationError = (error: any) =>
  ['42P01', 'PGRST205'].includes(String(error?.code || ''))
  || String(error?.message || '').toLowerCase().includes('gradebookannotation');

const resolveAccess = async (
  session: any,
  supabase: ReturnType<typeof createSupabaseServerClient>,
  annotationId: string,
) => {
  const existing = await getDashboardAnnotationById(supabase, annotationId);
  if (!existing) {
    return { access: null, annotation: null };
  }

  const access = await resolveLiveManageAccess(session, existing.courseId);
  return { access, annotation: existing };
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const annotationId = cleanString(params.id);
  if (!annotationId) {
    return json({ error: 'Annotation id is required' }, 400);
  }

  try {
    const supabase = createSupabaseServerClient({ requireServiceRole: true });
    const { access, annotation } = await resolveAccess(session, supabase, annotationId);
    if (!annotation) {
      return json({ error: 'Annotation not found' }, 404);
    }
    if (!access?.canManage) {
      return json({ error: 'Only teachers can edit dashboard annotations' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const updated = await updateDashboardAnnotation(supabase, annotationId, cleanString(access.userId), {
      color: body?.color,
      comment: body?.comment,
      visibility: normalizeDashboardAnnotationVisibility(body?.visibility),
      metadata: body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : annotation.metadata,
      authorName: cleanString(session?.user?.name, 320),
      authorEmail: cleanString(session?.user?.email, 320),
    });

    return json({ annotation: updated });
  } catch (error: any) {
    if (String(error?.message || '') === 'ANNOTATION_FORBIDDEN') {
      return json({ error: 'Only the author can edit this annotation' }, 403);
    }
    if (isMissingRelationError(error)) {
      return json({ error: 'GradebookAnnotation table missing. Run the latest migration.' }, 500);
    }
    console.error('Error updating dashboard annotation:', error);
    return json({ error: error?.message || 'Failed to update annotation' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const annotationId = cleanString(params.id);
  if (!annotationId) {
    return json({ error: 'Annotation id is required' }, 400);
  }

  try {
    const supabase = createSupabaseServerClient({ requireServiceRole: true });
    const { access, annotation } = await resolveAccess(session, supabase, annotationId);
    if (!annotation) {
      return json({ error: 'Annotation not found' }, 404);
    }
    if (!access?.canManage) {
      return json({ error: 'Only teachers can delete dashboard annotations' }, 403);
    }

    await deleteDashboardAnnotation(supabase, annotationId, cleanString(access.userId));
    return json({ success: true });
  } catch (error: any) {
    if (String(error?.message || '') === 'ANNOTATION_FORBIDDEN') {
      return json({ error: 'Only the author can delete this annotation' }, 403);
    }
    if (isMissingRelationError(error)) {
      return json({ error: 'GradebookAnnotation table missing. Run the latest migration.' }, 500);
    }
    console.error('Error deleting dashboard annotation:', error);
    return json({ error: error?.message || 'Failed to delete annotation' }, 500);
  }
};
