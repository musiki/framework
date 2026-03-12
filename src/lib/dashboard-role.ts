export const normalizeDashboardRole = (value: unknown) => String(value || '').trim().toLowerCase();

export const getRoleBadgeLabel = (value: unknown) =>
  normalizeDashboardRole(value) === 'teacher' ? 'Teacher' : 'Student';
