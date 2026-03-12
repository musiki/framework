import type { APIRoute } from 'astro';
import { createSupabaseServerClient, json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import {
  listDashboardAnnotations,
  upsertDashboardAnnotation,
} from '../../../lib/dashboard/annotation-store';
import { normalizeDashboardAnnotationVisibility } from '../../../lib/dashboard/annotations';

const cleanString = (value: unknown, maxLength = 240) =>
  String(value || '').trim().slice(0, maxLength);

const isMissingRelationError = (error: any) =>
  ['42P01', 'PGRST205'].includes(String(error?.code || ''))
  || String(error?.message || '').toLowerCase().includes('gradebookannotation');

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const url = new URL(request.url);
  const courseId = cleanString(url.searchParams.get('courseId'));
  const year = cleanString(url.searchParams.get('year'), 8);
  if (!courseId) {
    return json({ error: 'courseId is required' }, 400);
  }

  try {
    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) {
      return json({ error: 'Only teachers can read dashboard annotations' }, 403);
    }

    const supabase = createSupabaseServerClient({ requireServiceRole: true });
    const allAnnotations = await listDashboardAnnotations(supabase, { courseId, year });
    const visibleAnnotations = allAnnotations.filter((annotation) => {
      return annotation.visibility === 'teachers'
        || annotation.authorUserId === String(access.userId || '').trim();
    });

    return json({ annotations: visibleAnnotations });
  } catch (error: any) {
    if (isMissingRelationError(error)) {
      return json({ annotations: [] });
    }
    console.error('Error loading dashboard annotations:', error);
    return json({ error: error?.message || 'Failed to load annotations' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const courseId = cleanString(body?.courseId);
    const year = cleanString(body?.year, 8);
    if (!courseId || !year) {
      return json({ error: 'courseId and year are required' }, 400);
    }

    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) {
      return json({ error: 'Only teachers can create dashboard annotations' }, 403);
    }

    const supabase = createSupabaseServerClient({ requireServiceRole: true });
    const annotation = await upsertDashboardAnnotation(supabase, {
      courseId,
      year,
      subjectUserId: cleanString(body?.subjectUserId),
      field: cleanString(body?.field),
      tab: cleanString(body?.tab, 80),
      scopeType: cleanString(body?.scopeType, 80),
      scopeRef: cleanString(body?.scopeRef, 1024),
      color: body?.color,
      comment: body?.comment,
      visibility: normalizeDashboardAnnotationVisibility(body?.visibility),
      authorUserId: cleanString(access.userId),
      authorName: cleanString(session?.user?.name, 320),
      authorEmail: cleanString(session?.user?.email, 320),
      metadata: body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : {},
    });

    return json({ annotation });
  } catch (error: any) {
    if (isMissingRelationError(error)) {
      return json({ error: 'GradebookAnnotation table missing. Run the latest migration.' }, 500);
    }
    console.error('Error creating dashboard annotation:', error);
    return json({ error: error?.message || 'Failed to create annotation' }, 500);
  }
};
