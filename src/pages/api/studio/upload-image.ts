// Thin re-export: the forum upload handler requires an authenticated
// session and writes to R2 under a `forum/<kind>/...` key prefix — the
// prefix name is cosmetic, not a musiki-specific leak. It does not check
// tenant/studio membership, matching the brief's re-export instruction; see
// the task-6 report for a note on that gap.
export { POST } from '../forum/upload-image';

export const prerender = false;
