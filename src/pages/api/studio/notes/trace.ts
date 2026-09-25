// See annotations.ts for why access enforcement doesn't need to be repeated
// here — this wraps the musiki handlers only to add the studio-wide
// 404/CSRF guards every other studio route has.
import { GET as sourceGET, POST as sourcePOST, PUT as sourcePUT, DELETE as sourceDELETE } from '../../live/notes/trace';
import { wrapStudioRoute } from '../../../../lib/tenant/studio-wrap';

export const GET = wrapStudioRoute(sourceGET);
// POST/PUT read a JSON body (manual code, or bulk paragraph traces).
export const POST = wrapStudioRoute(sourcePOST, { mutation: true, requireJson: true });
export const PUT = wrapStudioRoute(sourcePUT, { mutation: true, requireJson: true });
// DELETE takes `id` as a query param, no body.
export const DELETE = wrapStudioRoute(sourceDELETE, { mutation: true, requireJson: false });

export const prerender = false;
