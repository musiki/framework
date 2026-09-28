// Wraps the shared musiki `POST /api/live/notes/versions` handler (re-exported
// by the studio under /api/studio/notes/versions) so that restoring a
// version of a note under the space's `Site` folder requests a so-web
// rebuild — the restore rewrites the note body directly in SQL, bypassing
// the space-notes mutations that normally fire `onSiteChange`.
//
// Pure (deps injected, `import type` only) so it is unit-testable under
// plain `node --test` with a stub handler and a real `Request`.

import type { APIContext, APIRoute } from 'astro';

export type RestoreRebuildDeps = {
  isNoteUnderSite: (noteId: string) => Promise<boolean>;
  requestRebuild: () => void;
};

export function withSiteRebuildOnRestore(handler: APIRoute, deps: RestoreRebuildDeps): APIRoute {
  return async (ctx: APIContext) => {
    // Read the body from a clone: the wrapped handler consumes the original.
    const payload = (await ctx.request.clone().json().catch(() => null)) as
      | { noteId?: unknown; versionId?: unknown }
      | null;
    const res = await handler(ctx);

    // Only a successful *restore* (versionId present) changes the note;
    // saving a new snapshot (versionName only) does not.
    const noteId = typeof payload?.noteId === 'string' ? payload.noteId : '';
    const isRestore = typeof payload?.versionId === 'string' && payload.versionId !== '';
    if (res instanceof Response && res.ok && isRestore && noteId) {
      // Fire-and-forget, like every other Site mutation: never delay or
      // fail the restore response over the rebuild trigger.
      void deps
        .isNoteUnderSite(noteId)
        .then((under) => {
          if (under) deps.requestRebuild();
        })
        .catch((err) => console.error('[site/version-restore] rebuild check failed:', err));
    }
    return res;
  };
}
