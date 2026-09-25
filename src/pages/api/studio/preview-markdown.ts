// Thin re-export: markdown preview rendering has no tenant-specific state
// (it renders whatever markdown it's given and touches no DB row scoped to
// a tenant or space), so it's safe to reuse the musiki handler as-is.
export { POST } from '../live/preview-markdown';

export const prerender = false;
