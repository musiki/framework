import { normalizeGlobalRole } from './roles';

export const getRoleBadgeLabel = (value: unknown) =>
  normalizeGlobalRole(value) === 'admin'
    ? 'Admin'
    : normalizeGlobalRole(value) === 'teacher'
      ? 'Teacher'
      : 'Student';
