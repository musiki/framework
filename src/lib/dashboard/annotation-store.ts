import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeDashboardAnnotationColor,
  normalizeDashboardAnnotationComment,
  normalizeDashboardAnnotationScopeType,
  normalizeDashboardAnnotationVisibility,
  type DashboardAnnotationRecord,
} from './annotations';

const cleanString = (value: unknown, maxLength = 240) =>
  String(value || '').trim().slice(0, maxLength);

const asMetadataObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export type AnnotationStoreInput = {
  courseId: string;
  year: string;
  subjectUserId?: string;
  field?: string;
  tab?: string;
  scopeType: string;
  scopeRef: string;
  color?: unknown;
  comment?: unknown;
  visibility?: unknown;
  authorUserId: string;
  authorName?: string;
  authorEmail?: string;
  metadata?: Record<string, any>;
};

export const mapDashboardAnnotationRow = (row: any): DashboardAnnotationRecord => ({
  id: cleanString(row?.id),
  courseId: cleanString(row?.courseId),
  year: cleanString(row?.year),
  subjectUserId: cleanString(row?.subjectUserId),
  field: cleanString(row?.field),
  tab: cleanString(row?.tab),
  scopeType: normalizeDashboardAnnotationScopeType(row?.scopeType) || 'overview_cell',
  scopeRef: cleanString(row?.scopeRef, 1024),
  color: normalizeDashboardAnnotationColor(row?.color),
  comment: normalizeDashboardAnnotationComment(row?.comment),
  visibility: normalizeDashboardAnnotationVisibility(row?.visibility),
  authorUserId: cleanString(row?.authorUserId),
  authorName: cleanString(row?.authorName, 320),
  authorEmail: cleanString(row?.authorEmail, 320),
  createdAt: cleanString(row?.createdAt, 80),
  updatedAt: cleanString(row?.updatedAt, 80),
  metadata: asMetadataObject(row?.metadata),
});

export async function listDashboardAnnotations(
  supabase: SupabaseClient,
  {
    courseId,
    year,
  }: {
    courseId: string;
    year?: string;
  },
) {
  let query = supabase
    .from('GradebookAnnotation')
    .select('*')
    .eq('courseId', cleanString(courseId))
    .order('updatedAt', { ascending: false });

  const normalizedYear = cleanString(year, 8);
  if (normalizedYear) {
    query = query.eq('year', normalizedYear);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(mapDashboardAnnotationRow);
}

export async function getDashboardAnnotationById(
  supabase: SupabaseClient,
  annotationId: string,
) {
  const { data, error } = await supabase
    .from('GradebookAnnotation')
    .select('*')
    .eq('id', cleanString(annotationId))
    .maybeSingle();

  if (error) throw error;
  return data ? mapDashboardAnnotationRow(data) : null;
}

export async function upsertDashboardAnnotation(
  supabase: SupabaseClient,
  input: AnnotationStoreInput,
) {
  const scopeType = normalizeDashboardAnnotationScopeType(input.scopeType);
  const scopeRef = cleanString(input.scopeRef, 1024);
  const authorUserId = cleanString(input.authorUserId);
  const courseId = cleanString(input.courseId);
  const year = cleanString(input.year, 8);
  if (!scopeType || !scopeRef || !authorUserId || !courseId || !year) {
    throw new Error('ANNOTATION_INPUT_INVALID');
  }

  const nextColor = normalizeDashboardAnnotationColor(input.color);
  const nextComment = normalizeDashboardAnnotationComment(input.comment);
  const nextVisibility = normalizeDashboardAnnotationVisibility(input.visibility);
  const payload = {
    courseId,
    year,
    subjectUserId: cleanString(input.subjectUserId),
    field: cleanString(input.field),
    tab: cleanString(input.tab, 80),
    scopeType,
    scopeRef,
    color: nextColor || null,
    comment: nextComment,
    visibility: nextVisibility,
    authorUserId,
    authorName: cleanString(input.authorName, 320),
    authorEmail: cleanString(input.authorEmail, 320),
    metadata: asMetadataObject(input.metadata),
  };

  const { data: existing, error: existingError } = await supabase
    .from('GradebookAnnotation')
    .select('*')
    .eq('authorUserId', authorUserId)
    .eq('courseId', courseId)
    .eq('year', year)
    .eq('scopeType', scopeType)
    .eq('scopeRef', scopeRef)
    .maybeSingle();
  if (existingError) throw existingError;

  if (!nextColor && !nextComment) {
    if (existing?.id) {
      const { error: deleteError } = await supabase
        .from('GradebookAnnotation')
        .delete()
        .eq('id', existing.id);
      if (deleteError) throw deleteError;
    }
    return null;
  }

  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from('GradebookAnnotation')
      .update({
        ...payload,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    return mapDashboardAnnotationRow(updated);
  }

  const { data: inserted, error: insertError } = await supabase
    .from('GradebookAnnotation')
    .insert([
      {
        ...payload,
      },
    ])
    .select('*')
    .single();
  if (insertError) throw insertError;
  return mapDashboardAnnotationRow(inserted);
}

export async function updateDashboardAnnotation(
  supabase: SupabaseClient,
  annotationId: string,
  authorUserId: string,
  patch: Partial<AnnotationStoreInput>,
) {
  const existing = await getDashboardAnnotationById(supabase, annotationId);
  if (!existing) return null;
  if (cleanString(existing.authorUserId) !== cleanString(authorUserId)) {
    throw new Error('ANNOTATION_FORBIDDEN');
  }

  return upsertDashboardAnnotation(supabase, {
    courseId: existing.courseId,
    year: existing.year,
    subjectUserId: patch.subjectUserId ?? existing.subjectUserId,
    field: patch.field ?? existing.field,
    tab: patch.tab ?? existing.tab,
    scopeType: patch.scopeType ?? existing.scopeType,
    scopeRef: patch.scopeRef ?? existing.scopeRef,
    color: patch.color ?? existing.color,
    comment: patch.comment ?? existing.comment,
    visibility: patch.visibility ?? existing.visibility,
    authorUserId,
    authorName: patch.authorName ?? existing.authorName,
    authorEmail: patch.authorEmail ?? existing.authorEmail,
    metadata: patch.metadata ?? existing.metadata,
  });
}

export async function deleteDashboardAnnotation(
  supabase: SupabaseClient,
  annotationId: string,
  authorUserId: string,
) {
  const existing = await getDashboardAnnotationById(supabase, annotationId);
  if (!existing) return false;
  if (cleanString(existing.authorUserId) !== cleanString(authorUserId)) {
    throw new Error('ANNOTATION_FORBIDDEN');
  }

  const { error } = await supabase
    .from('GradebookAnnotation')
    .delete()
    .eq('id', existing.id);
  if (error) throw error;
  return true;
}
