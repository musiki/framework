// See annotations.ts for why access enforcement doesn't need to be repeated
// here — this wraps the musiki handlers only to add the studio-wide
// 404/CSRF guards every other studio route has.
import { GET as sourceGET, POST as sourcePOST, PATCH as sourcePATCH, DELETE as sourceDELETE } from '../../live/notes/versions';
import { wrapStudioRoute } from '../../../../lib/tenant/studio-wrap';
import { query } from '../../../../lib/db/pool';
import { isNoteUnderSite } from '../../../../lib/writing/notes/space-notes-core.ts';
import { requestSiteRebuild } from '../../../../lib/site/rebuild.ts';
import { withSiteRebuildOnRestore } from '../../../../lib/site/version-restore.ts';

export const GET = wrapStudioRoute(sourceGET);
// POST/PATCH read a JSON body (save/restore a version, rename/resave).
// A restore rewrites the note body directly (bypassing space-notes'
// onSiteChange), so POST additionally requests a so-web rebuild when the
// restored note is under Site. PATCH only touches the version row.
export const POST = wrapStudioRoute(
  withSiteRebuildOnRestore(sourcePOST, {
    isNoteUnderSite: (noteId) => isNoteUnderSite(query, noteId),
    requestRebuild: () => {
      void requestSiteRebuild();
    },
  }),
  { mutation: true, requireJson: true },
);
export const PATCH = wrapStudioRoute(sourcePATCH, { mutation: true, requireJson: true });
// DELETE takes `versionId` as a query param, no body.
export const DELETE = wrapStudioRoute(sourceDELETE, { mutation: true, requireJson: false });

export const prerender = false;
