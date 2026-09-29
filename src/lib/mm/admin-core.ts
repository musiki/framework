// mm access administration (spec §3, §5 "invites, rules, roles, open-join":
// admin only). Pure, q-injected. Invites and rules themselves are created
// through studio-db's createInvite/addRule/listRules/removeRule with commons
// validation (validateInviteInput/validateAccessRuleInput(…, 'commons'): never
// `admin`); this module adds what studio lacks: the admin gate, member list,
// role change, removal (+ SpaceMemberBlock), pending invites and open-join.

import { can } from './policy.ts';
import { getCommonsRole, withTransaction, type QueryFn } from './concepts-core.ts';
import { isRoleForKind, isUuid, type CommonsRole } from '../tenant/space-roles.ts';
import { MmApiError } from './api-core.ts';

async function run(q: QueryFn, text: string, params: unknown[] = []): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw error instanceof Error ? error : new Error(String(error?.message || error));
  return data ?? [];
}

/** 401 anonymous, 403 unless the user is an admin of this commons space. */
export async function requireAdmin(q: QueryFn, spaceId: string, userId: string | null): Promise<CommonsRole> {
  if (!userId) throw new MmApiError(401, 'sign in required');
  const role = await getCommonsRole(q, spaceId, userId);
  if (!role || !can(role, 'manageAccess')) throw new MmApiError(403, 'Forbidden');
  return role;
}

export type MemberRow = {
  userId: string;
  name: string | null;
  email: string | null;
  role: CommonsRole;
  joinedAt: string;
};

/** Admin view: members with emails (never exposed outside the admin API). */
export async function listMembers(q: QueryFn, spaceId: string): Promise<MemberRow[]> {
  const r = await run(
    q,
    `SELECT m."userId", u.name, u.email, m.role, m."createdAt" AS "joinedAt"
       FROM "SpaceMember" m JOIN "User" u ON u.id = m."userId"
      WHERE m."spaceId" = $1::uuid
      ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'curator' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
               lower(COALESCE(u.name, u.email, '')) ASC, m."userId" ASC`,
    [spaceId],
  );
  return r.map((x) => ({ userId: x.userId, name: x.name ?? null, email: x.email ?? null, role: x.role, joinedAt: x.joinedAt }));
}

function requireTarget(actorUserId: string, targetUserId: unknown): string {
  if (typeof targetUserId !== 'string' || !isUuid(targetUserId)) throw new MmApiError(400, 'invalid userId');
  if (targetUserId === actorUserId) throw new MmApiError(409, 'you cannot change or remove your own membership');
  return targetUserId;
}

/**
 * Locks the space's admin rows (FOR UPDATE; call inside a transaction) and
 * refuses when the acting admin lost admin meanwhile (403) or when the change
 * would leave the space without an admin (409). Concurrent demotions serialize
 * on these locks, so two admins cannot demote each other to zero.
 */
async function guardAdmins(
  q: QueryFn,
  spaceId: string,
  actorUserId: string,
  targetUserId: string,
  targetStaysAdmin: boolean,
): Promise<void> {
  const admins = (
    await run(
      q,
      `SELECT "userId" FROM "SpaceMember" WHERE "spaceId" = $1::uuid AND role = 'admin' ORDER BY "userId" FOR UPDATE`,
      [spaceId],
    )
  ).map((r) => r.userId as string);
  if (!admins.includes(actorUserId)) throw new MmApiError(403, 'Forbidden');
  const remaining = admins.filter((u) => u !== targetUserId).length + (targetStaysAdmin ? 1 : 0);
  if (remaining < 1) throw new MmApiError(409, 'the space must keep at least one admin');
}

/**
 * Any commons role (admins may promote to admin; invites/rules never grant it).
 * Never your own membership; never leaves zero admins. One transaction; `q`
 * must be bound to one client.
 */
export async function setMemberRole(
  q: QueryFn,
  input: { spaceId: string; actorUserId: string; targetUserId: unknown; role: unknown },
): Promise<{ userId: string; role: CommonsRole }> {
  const target = requireTarget(input.actorUserId, input.targetUserId);
  if (!isRoleForKind('commons', input.role)) throw new MmApiError(400, 'invalid-role');
  const role = input.role as CommonsRole;
  return withTransaction(q, async () => {
    await guardAdmins(q, input.spaceId, input.actorUserId, target, role === 'admin');
    const r = await run(
      q,
      `UPDATE "SpaceMember" SET role = $1 WHERE "spaceId" = $2::uuid AND "userId" = $3::uuid RETURNING role`,
      [role, input.spaceId, target],
    );
    if (!r.length) throw new MmApiError(404, 'member not found');
    return { userId: target, role: r[0].role };
  });
}

/**
 * Removes a member and records a SpaceMemberBlock row so neither open-join
 * nor email/domain rules re-admit them (only an explicit invite does, and
 * accepting it deletes the block). Never your own membership; never the last
 * admin. One transaction; `q` must be bound to one client.
 */
export async function removeMember(
  q: QueryFn,
  input: { spaceId: string; actorUserId: string; targetUserId: unknown },
): Promise<{ removed: true }> {
  const target = requireTarget(input.actorUserId, input.targetUserId);
  return withTransaction(q, async () => {
    await guardAdmins(q, input.spaceId, input.actorUserId, target, false);
    const r = await run(
      q,
      `DELETE FROM "SpaceMember" WHERE "spaceId" = $1::uuid AND "userId" = $2::uuid RETURNING "userId"`,
      [input.spaceId, target],
    );
    if (!r.length) throw new MmApiError(404, 'member not found');
    await run(
      q,
      `INSERT INTO "SpaceMemberBlock" ("spaceId", "userId") VALUES ($1::uuid, $2::uuid)
       ON CONFLICT ("spaceId", "userId") DO NOTHING`,
      [input.spaceId, target],
    );
    return { removed: true as const };
  });
}

export type InviteView = { id: string; email: string; role: string; expiresAt: string; createdAt: string | null };

/** Pending (unaccepted, unexpired) invites; the token is never returned. */
export async function listPendingInvites(q: QueryFn, spaceId: string): Promise<InviteView[]> {
  const r = await run(
    q,
    `SELECT id, email, role, "expiresAt", "createdAt" FROM "SpaceInvite"
      WHERE "spaceId" = $1::uuid AND "acceptedAt" IS NULL AND "expiresAt" > now()
      ORDER BY "createdAt" DESC NULLS LAST, id ASC`,
    [spaceId],
  );
  return r.map((x) => ({ id: x.id, email: x.email, role: x.role, expiresAt: x.expiresAt, createdAt: x.createdAt ?? null }));
}

export async function revokeInvite(q: QueryFn, spaceId: string, inviteId: unknown): Promise<void> {
  if (typeof inviteId !== 'string' || !isUuid(inviteId)) throw new MmApiError(400, 'invalid inviteId');
  const r = await run(
    q,
    `DELETE FROM "SpaceInvite" WHERE id = $1::uuid AND "spaceId" = $2::uuid AND "acceptedAt" IS NULL RETURNING id`,
    [inviteId, spaceId],
  );
  if (!r.length) throw new MmApiError(404, 'invite not found');
}

/** `Space.settings.openJoin` as a JSON boolean. */
export async function setOpenJoin(q: QueryFn, spaceId: string, value: unknown): Promise<{ openJoin: boolean }> {
  if (typeof value !== 'boolean') throw new MmApiError(400, 'openJoin must be a boolean');
  const r = await run(
    q,
    `UPDATE "Space" SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{openJoin}', to_jsonb($1::boolean), true)
      WHERE id = $2::uuid AND kind = 'commons' RETURNING settings -> 'openJoin' AS "openJoin"`,
    [value, spaceId],
  );
  if (!r.length) throw new MmApiError(404, 'space not found');
  return { openJoin: r[0].openJoin === true };
}

export const openJoinOf = (settings: Record<string, unknown>): boolean => settings?.openJoin === true;
