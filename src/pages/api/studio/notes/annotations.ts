// Access is enforced by the tenant-aware `getNoteAccess` (see
// src/lib/writing/notes/access-core.ts), which already scopes space-bound
// notes to their owning tenant — so wrapping the musiki handlers here (only
// to add the studio-wide 404/CSRF guards every other studio route has)
// serves `so` notes only.
import { GET as sourceGET, POST as sourcePOST, DELETE as sourceDELETE } from '../../live/notes/annotations';
import { wrapStudioRoute } from '../../../../lib/tenant/studio-wrap';

export const GET = wrapStudioRoute(sourceGET);
// POST reads a JSON body (root annotation or comment reply).
export const POST = wrapStudioRoute(sourcePOST, { mutation: true, requireJson: true });
// DELETE takes `id`/`commentId` as query params, no body.
export const DELETE = wrapStudioRoute(sourceDELETE, { mutation: true, requireJson: false });

export const prerender = false;
