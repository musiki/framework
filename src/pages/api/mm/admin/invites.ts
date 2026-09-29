import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { listPendingInvites, requireAdmin, revokeInvite } from '../../../../lib/mm/admin-core';
import { resolveRequestAuthOrigin } from '../../../../lib/auth-origin';
import { validateInviteInput } from '../../../../lib/tenant/space-roles';
import { createInvite, INVITE_TTL_DAYS } from '../../../../lib/tenant/studio-db';

export const prerender = false;

// Admin only. Invites grant curator | member | guest (never admin).
export const GET = mmRoute({ auth: true, tag: 'mm:admin:invites' }, async (_ctx, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  return json({ invites: await listPendingInvites(q, space.id) });
});

export const POST = mmRoute({ mutation: true, tag: 'mm:admin:invites' }, async ({ request }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const body = await readJsonObject(request);
  const input = validateInviteInput({ email: body.email, role: body.role }, 'commons');
  if (!input.ok) return json({ error: input.error }, 400);
  await createInvite({ spaceId: space.id, email: input.email, role: input.role, createdBy: userId as string });
  // Invites are matched by email at sign-in; the link is the join page.
  return json({ url: `${resolveRequestAuthOrigin(request)}/join`, email: input.email, role: input.role, expiresInDays: INVITE_TTL_DAYS }, 201);
});

// ?id=<inviteId>
export const DELETE = mmRoute({ mutation: true, requireJson: false, tag: 'mm:admin:invites' }, async ({ url }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  await revokeInvite(q, space.id, url.searchParams.get('id'));
  return json({ ok: true });
});
