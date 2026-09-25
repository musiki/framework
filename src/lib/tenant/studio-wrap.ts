import type { APIContext, APIRoute } from 'astro';
import { json } from '../forum-server';
import { studioEnabled } from './studio-db';
import { assertSameOriginJson } from './studio-http';

export type WrapStudioRouteOptions = {
  /** Mutating methods (POST/PUT/PATCH/DELETE) get a CSRF check before delegating. */
  mutation?: boolean;
  /** Passed through to `assertSameOriginJson`'s `requireJson` when `mutation` is set. */
  requireJson?: boolean;
};

/**
 * Wraps a musiki API route handler (e.g. `GET` from `../live/notes/annotations`)
 * so it can be re-exported under `/api/studio/*` with the same two guards every
 * other studio route applies by hand:
 *
 *  - 404 when the tenant doesn't have the studio enabled (`studioEnabled`).
 *  - CSRF/content-type rejection for mutating methods (`assertSameOriginJson`).
 *
 * The wrapped handler still does its own auth (`ensureDbUserFromSession`) and
 * tenant-scoped access checks (`getNoteAccess`) — this wrapper only adds the
 * two checks that a bare re-export was missing.
 */
export function wrapStudioRoute(handler: APIRoute, opts: WrapStudioRouteOptions = {}): APIRoute {
  return async (ctx: APIContext) => {
    if (!studioEnabled(ctx.locals.tenant)) return json({ error: 'Not found' }, 404);
    if (opts.mutation) {
      const csrf = assertSameOriginJson(ctx.request, { requireJson: opts.requireJson ?? false });
      if (csrf) return csrf;
    }
    return handler(ctx);
  };
}
