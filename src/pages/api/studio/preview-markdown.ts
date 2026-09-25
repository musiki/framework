// Markdown preview rendering has no tenant-specific state (it renders
// whatever markdown it's given and touches no DB row scoped to a tenant or
// space), so it's safe to reuse the musiki handler — wrapped only to add
// the studio-wide 404/CSRF guards every other studio route has.
import { POST as sourcePOST } from '../live/preview-markdown';
import { wrapStudioRoute } from '../../../lib/tenant/studio-wrap';

// POST reads a JSON body ({ markdown, interactiveBlocks }).
export const POST = wrapStudioRoute(sourcePOST, { mutation: true, requireJson: true });

export const prerender = false;
