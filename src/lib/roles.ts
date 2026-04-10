export type GlobalUserRole = 'student' | 'teacher' | 'admin';
export type ElevatedGlobalUserRole = 'teacher' | 'admin';

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

export const normalizeGlobalRole = (value: unknown): GlobalUserRole => {
  const normalized = normalizeText(value);
  if (normalized === 'admin') return 'admin';
  if (normalized === 'teacher') return 'teacher';
  return 'student';
};

export const isAdminGlobalRole = (value: unknown): boolean =>
  normalizeGlobalRole(value) === 'admin';

export const isElevatedGlobalRole = (value: unknown): boolean => {
  const normalized = normalizeGlobalRole(value);
  return normalized === 'teacher' || normalized === 'admin';
};

export const toParticipantRole = (value: unknown): 'teacher' | 'student' =>
  isElevatedGlobalRole(value) ? 'teacher' : 'student';
