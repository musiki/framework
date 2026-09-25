// Thin re-export: annotation access is enforced by the tenant-aware
// `getNoteAccess` (see src/lib/writing/notes/access-core.ts), which already
// scopes space-bound notes to their owning tenant — so re-exporting the
// musiki handler here serves `so` notes only.
export { GET, POST, DELETE } from '../../live/notes/annotations';

export const prerender = false;
