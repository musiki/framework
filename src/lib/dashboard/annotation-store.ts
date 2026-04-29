import { query } from '../db/pool';
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
  _unused_supabase: any,
  {
    courseId,
    year,
  }: {
    courseId: string;
    year?: string;
  },
) {
  const params: any[] = [cleanString(courseId)];
  let sql = `SELECT * FROM "GradebookAnnotation" WHERE "courseId" = $1`;
  
  const normalizedYear = cleanString(year, 8);
  if (normalizedYear) {
    params.push(normalizedYear);
    sql += ` AND "year" = $${params.length}`;
  }
  
  sql += ` ORDER BY "updatedAt" DESC`;

  const { data, error } = await query(sql, params);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(mapDashboardAnnotationRow);
}

export async function getDashboardAnnotationById(
  _unused_supabase: any,
  annotationId: string,
) {
  const { data, error } = await query(
    `SELECT * FROM "GradebookAnnotation" WHERE "id" = $1`,
    [cleanString(annotationId)]
  );

  if (error) throw error;
  return data?.[0] ? mapDashboardAnnotationRow(data[0]) : null;
}

export async function upsertDashboardAnnotation(
  _unused_supabase: any,
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

  const payload = {
    courseId,
    year,
    subjectUserId: cleanString(input.subjectUserId),
    field: cleanString(input.field),
    tab: cleanString(input.tab),
    scopeType,
    scopeRef,
    color: normalizeDashboardAnnotationColor(input.color),
    comment: normalizeDashboardAnnotationComment(input.comment),
    visibility: normalizeDashboardAnnotationVisibility(input.visibility),
    authorUserId,
    authorName: cleanString(input.authorName, 320),
    authorEmail: cleanString(input.authorEmail, 320),
    updatedAt: new Date().toISOString(),
    metadata: input.metadata || {},
  };

  const { data: existingRows } = await query(
    `SELECT id FROM "GradebookAnnotation" 
     WHERE "courseId" = $1 AND "year" = $2 AND "scopeType" = $3 AND "scopeRef" = $4 AND "authorUserId" = $5`,
    [courseId, year, scopeType, scopeRef, authorUserId]
  );

  const existing = existingRows?.[0];

  if (existing) {
    const cols = Object.keys(payload);
    const vals = Object.values(payload);
    const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const { data, error } = await query(
      `UPDATE "GradebookAnnotation" SET ${setSql} WHERE id = $${cols.length + 1} RETURNING *`,
      [...vals, existing.id]
    );
    if (error) throw error;
    return data?.[0] ? mapDashboardAnnotationRow(data[0]) : null;
  } else {
    const finalPayload = { ...payload, createdAt: payload.updatedAt };
    const cols = Object.keys(finalPayload);
    const vals = Object.values(finalPayload);
    const colSql = cols.map(c => `"${c}"`).join(', ');
    const valSql = cols.map((_, i) => `$${i + 1}`).join(', ');
    const { data, error } = await query(
      `INSERT INTO "GradebookAnnotation" (${colSql}) VALUES (${valSql}) RETURNING *`,
      vals
    );
    if (error) throw error;
    return data?.[0] ? mapDashboardAnnotationRow(data[0]) : null;
  }
}

export async function updateDashboardAnnotation(
  _unused_supabase: any,
  annotationId: string,
  authorUserId: string,
  input: Partial<AnnotationStoreInput>
) {
  const { data: existingRows } = await query(
    `SELECT * FROM "GradebookAnnotation" WHERE "id" = $1`,
    [cleanString(annotationId)]
  );
  const existing = existingRows?.[0];
  if (!existing) throw new Error('ANNOTATION_NOT_FOUND');

  // Authorization check: only author can edit
  if (existing.authorUserId !== authorUserId) {
    throw new Error('ANNOTATION_FORBIDDEN');
  }

  const payload: any = {
    updatedAt: new Date().toISOString(),
  };
  if (input.color !== undefined) payload.color = normalizeDashboardAnnotationColor(input.color);
  if (input.comment !== undefined) payload.comment = normalizeDashboardAnnotationComment(input.comment);
  if (input.visibility !== undefined) payload.visibility = normalizeDashboardAnnotationVisibility(input.visibility);
  if (input.metadata !== undefined) payload.metadata = input.metadata;
  if (input.authorName !== undefined) payload.authorName = cleanString(input.authorName, 320);
  if (input.authorEmail !== undefined) payload.authorEmail = cleanString(input.authorEmail, 320);

  const cols = Object.keys(payload);
  const vals = Object.values(payload);
  const setSql = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');

  const { data, error } = await query(
    `UPDATE "GradebookAnnotation" SET ${setSql} WHERE id = $${cols.length + 1} RETURNING *`,
    [...vals, existing.id]
  );

  if (error) throw error;
  return data?.[0] ? mapDashboardAnnotationRow(data[0]) : null;
}

export async function deleteDashboardAnnotation(
  _unused_supabase: any,
  annotationId: string,
  authorUserId: string,
) {
  const { data: existingRows } = await query(
    `SELECT id, "authorUserId" FROM "GradebookAnnotation" WHERE "id" = $1`,
    [cleanString(annotationId)]
  );
  const existing = existingRows?.[0];
  if (!existing) return; // Already deleted or doesn't exist

  if (existing.authorUserId !== authorUserId) {
    throw new Error('ANNOTATION_FORBIDDEN');
  }

  const { error } = await query(
    `DELETE FROM "GradebookAnnotation" WHERE id = $1`,
    [cleanString(annotationId)]
  );
  if (error) throw error;
}
