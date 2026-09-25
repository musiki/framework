import crypto from 'node:crypto';
import { query } from '../db/pool';
import { resolveUserIdByEmail } from '../user-email';
import { isUuid, type SpaceRole } from './space-roles';
import type { Tenant, TenantId } from './tenants';

export const INVITE_TTL_DAYS = 14;

export type Membership = { spaceId: string; slug: string; title: string; lang: string; role: SpaceRole };
export type RuleRow = { id: string; kind: 'email' | 'domain'; value: string; role: SpaceRole; createdAt: string };

const must = <T>(res: { data: T[] | null; error: any }): T[] => {
  if (res.error) throw new Error(res.error.message || 'Database error');
  return res.data ?? [];
};

export const studioEnabled = (tenant: Tenant): boolean => tenant.spaceKinds.includes('dissertation');

export async function getStudioUserId(locals: App.Locals): Promise<string | null> {
  const email = locals.session?.user?.email;
  return email ? resolveUserIdByEmail(email) : null;
}

const MEMBERSHIP_SQL = `
  SELECT s."id" AS "spaceId", s."slug", s."title", s."lang", m."role"
    FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
   WHERE s."tenantId" = $1 AND m."userId" = $2`;

export async function listMemberships(tenantId: TenantId, userId: string): Promise<Membership[]> {
  return must<Membership>(await query(`${MEMBERSHIP_SQL} ORDER BY s."title"`, [tenantId, userId]));
}

export async function getMembership(tenantId: TenantId, userId: string, spaceId: string): Promise<Membership | null> {
  if (!isUuid(spaceId)) return null;
  return (must<Membership>(await query(`${MEMBERSHIP_SQL} AND s."id" = $3`, [tenantId, userId, spaceId]))[0] ?? null);
}

export async function createInvite(input: { spaceId: string; email: string; role: SpaceRole; createdBy: string }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  must(await query(
    `INSERT INTO "SpaceInvite" ("spaceId", "email", "role", "token", "expiresAt", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.spaceId, input.email, input.role, token, expiresAt.toISOString(), input.createdBy],
  ));
  return { token, expiresAt };
}

export async function findValidInvite(tenantId: TenantId, token: string) {
  return (must<{ spaceTitle: string; email: string }>(await query(
    `SELECT s."title" AS "spaceTitle", i."email"
       FROM "SpaceInvite" i JOIN "Space" s ON s."id" = i."spaceId"
      WHERE s."tenantId" = $1 AND i."token" = $2 AND i."acceptedAt" IS NULL AND i."expiresAt" > now()`,
    [tenantId, token],
  ))[0] ?? null);
}

export async function listRules(spaceId: string): Promise<RuleRow[]> {
  return must<RuleRow>(await query(
    `SELECT "id", "kind", "value", "role", "createdAt" FROM "SpaceAccessRule"
      WHERE "spaceId" = $1 ORDER BY "kind", "value"`,
    [spaceId],
  ));
}

export async function addRule(input: { spaceId: string; kind: 'email' | 'domain'; value: string; role: SpaceRole; createdBy: string }) {
  must(await query(
    `INSERT INTO "SpaceAccessRule" ("spaceId", "kind", "value", "role", "createdBy")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("spaceId", "kind", "value") DO UPDATE SET "role" = EXCLUDED."role"`,
    [input.spaceId, input.kind, input.value, input.role, input.createdBy],
  ));
}

export async function removeRule(spaceId: string, ruleId: string): Promise<boolean> {
  if (!isUuid(spaceId) || !isUuid(ruleId)) return false;
  const deleted = must<{ id: string }>(await query(
    `DELETE FROM "SpaceAccessRule" WHERE "spaceId" = $1 AND "id" = $2 RETURNING "id"`,
    [spaceId, ruleId],
  ));
  return deleted.length > 0;
}
