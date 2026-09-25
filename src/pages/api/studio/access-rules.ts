import type { APIRoute, APIContext } from 'astro';
import { json } from '../../../lib/forum-server';
import { validateAccessRuleInput } from '../../../lib/tenant/space-roles';
import { addRule, getMembership, getStudioUserId, listRules, removeRule, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

async function requireAuthor(ctx: APIContext, spaceId: string): Promise<{ error: Response } | { userId: string }> {
  if (!studioEnabled(ctx.locals.tenant)) return { error: json({ error: 'Not found' }, 404) };
  const userId = await getStudioUserId(ctx.locals);
  if (!userId) return { error: json({ error: 'Not authenticated' }, 401) };
  const membership = await getMembership(ctx.locals.tenant.id, userId, spaceId);
  if (membership?.role !== 'author') return { error: json({ error: 'Forbidden' }, 403) };
  return { userId };
}

export const GET: APIRoute = async (ctx) => {
  const spaceId = ctx.url.searchParams.get('spaceId') || '';
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  return json({ rules: await listRules(spaceId) });
};

export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json().catch(() => ({}));
  const spaceId = String(body.spaceId || '');
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  const input = validateAccessRuleInput({ kind: body.kind, value: body.value, role: body.role });
  if (!input.ok) return json({ error: input.error }, 400);
  await addRule({ spaceId, kind: input.kind, value: input.value, role: input.role, createdBy: guard.userId });
  return json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const spaceId = ctx.url.searchParams.get('spaceId') || '';
  const ruleId = ctx.url.searchParams.get('ruleId') || '';
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  await removeRule(spaceId, ruleId);
  return json({ ok: true });
};
