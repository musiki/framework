// DB-bound bindings for the mm API wrapper (see api-core.ts). Routes do:
//   export const GET = mmRoute({}, async (ctx, env) => …);
//   export const POST = mmRoute({ mutation: true }, async (ctx, env) => …);

import type { APIRoute } from 'astro';
import { query } from '../db/pool';
import { resolveRequestAuthOrigin } from '../auth-origin';
import { resolveUserIdByEmail } from '../user-email';
import { loadMmSpace, mmHandler, type MmCtx, type MmEnv, type MmHandlerOptions, type MmDeps } from './api-core.ts';
import type { QueryFn } from './concepts-core.ts';

export { json, readJsonObject, requireUuidParam, MmApiError } from './api-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

const deps: MmDeps = {
  expectedOrigin: (request) => resolveRequestAuthOrigin(request),
  loadSpace: () => loadMmSpace(poolQ),
  loadUserId: async (locals) => {
    const email = locals?.session?.user?.email;
    return email ? resolveUserIdByEmail(email) : null;
  },
  q: poolQ,
};

export function mmRoute(opts: MmHandlerOptions, fn: (ctx: MmCtx, env: MmEnv) => Promise<Response>): APIRoute {
  const handler = mmHandler(opts, fn, deps);
  return (ctx) => handler({ request: ctx.request, url: ctx.url, params: ctx.params, locals: ctx.locals });
}
