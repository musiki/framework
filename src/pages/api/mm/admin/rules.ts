import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../lib/mm/api';
import { requireAdmin } from '../../../../lib/mm/admin-core';
import { validateAccessRuleInput } from '../../../../lib/tenant/space-roles';
import { addRule, listRules, removeRule } from '../../../../lib/tenant/studio-db';

export const prerender = false;

// Admin only. Email/domain rules grant curator | member | guest (never admin).
export const GET = mmRoute({ auth: true, tag: 'mm:admin:rules' }, async (_ctx, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  return json({ rules: await listRules(space.id) });
});

export const POST = mmRoute({ mutation: true, tag: 'mm:admin:rules' }, async ({ request }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const body = await readJsonObject(request);
  const input = validateAccessRuleInput({ kind: body.kind, value: body.value, role: body.role }, 'commons');
  if (!input.ok) return json({ error: input.error }, 400);
  await addRule({ spaceId: space.id, kind: input.kind, value: input.value, role: input.role, createdBy: userId as string });
  return json({ ok: true }, 201);
});

// ?ruleId=<id>
export const DELETE = mmRoute({ mutation: true, requireJson: false, tag: 'mm:admin:rules' }, async ({ url }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const ruleId = requireUuidParam(url.searchParams.get('ruleId'), 'ruleId');
  if (!(await removeRule(space.id, ruleId))) return json({ error: 'Not found' }, 404);
  return json({ ok: true });
});
