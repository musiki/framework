// See annotations.ts for why access enforcement doesn't need to be repeated
// here — this wraps the musiki handlers only to add the studio-wide
// 404/CSRF guards every other studio route has.
import { GET as sourceGET, POST as sourcePOST, PATCH as sourcePATCH, DELETE as sourceDELETE } from '../../live/notes/versions';
import { wrapStudioRoute } from '../../../../lib/tenant/studio-wrap';

export const GET = wrapStudioRoute(sourceGET);
// POST/PATCH read a JSON body (save/restore a version, rename/resave).
export const POST = wrapStudioRoute(sourcePOST, { mutation: true, requireJson: true });
export const PATCH = wrapStudioRoute(sourcePATCH, { mutation: true, requireJson: true });
// DELETE takes `versionId` as a query param, no body.
export const DELETE = wrapStudioRoute(sourceDELETE, { mutation: true, requireJson: false });

export const prerender = false;
