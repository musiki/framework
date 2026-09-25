import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveRequestAuthOrigin } from '../../../lib/auth-origin';
import { validateInviteInput } from '../../../lib/tenant/space-roles';
import { createInvite, getMembership, getStudioUserId, INVITE_TTL_DAYS, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const spaceId = String(body.spaceId || '');
  const membership = await getMembership(locals.tenant.id, userId, spaceId);
  if (membership?.role !== 'author') return json({ error: 'Forbidden' }, 403);

  const input = validateInviteInput({ email: body.email, role: body.role });
  if (!input.ok) return json({ error: input.error }, 400);

  const { token } = await createInvite({ spaceId, email: input.email, role: input.role, createdBy: userId });
  const url = `${resolveRequestAuthOrigin(request)}/studio/invite/${token}`;
  return json({ url, expiresInDays: INVITE_TTL_DAYS });
};
