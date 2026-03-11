const normalizeText = (value: unknown) => String(value || '').trim();

export const getCourseFrontmatterId = (
  courseData: Record<string, unknown> = {},
  fallback = '',
) => normalizeText(courseData.id || courseData.code || fallback);

export const getCourseLegacyCode = (courseData: Record<string, unknown> = {}) =>
  normalizeText(courseData.code);
