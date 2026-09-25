import type { NoteAccessDetail } from './access-core.ts';

// Course versions retain their original editor-only policy; space versions are
// the explicit review surface for members with read access.
export const canReadVersions = (detail: NoteAccessDetail): boolean =>
  detail.access === 'edit' || (detail.spaceId !== null && detail.access !== null);
export const canReadLiveDetails = (detail: NoteAccessDetail): boolean =>
  detail.access !== null && !detail.versionsOnly;
