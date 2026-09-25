// The forum upload handler requires an authenticated session and writes to
// R2 under a `forum/<kind>/...` key prefix — the prefix name is cosmetic,
// not a musiki-specific leak, and the response contains no musiki-specific
// URLs. It is wrapped (rather than bare re-exported) so a musiki-tenant
// session can no longer reach it via /api/studio — the studio-wide
// `studioEnabled` 404 guard now applies here like every other studio route.
import { POST as sourcePOST } from '../forum/upload-image';
import { wrapStudioRoute } from '../../../lib/tenant/studio-wrap';

// POST reads multipart form data (the uploaded file), not JSON.
export const POST = wrapStudioRoute(sourcePOST, { mutation: true, requireJson: false });

export const prerender = false;
