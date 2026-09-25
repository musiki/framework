import { getClient, query } from '../db/pool';
import { resolveUserIdByEmail } from '../user-email';
import { decideSpaceAccess, shouldRejectMusikiSignIn, type AccessRuleRow, type InviteRow } from './access';
import { emailDomain, normalizeEmail } from './space-roles';
import { DEFAULT_TENANT_ID, type TenantId } from './tenants';

const must = <T>(res: { data: T[] | null; error: any }): T[] => {
  if (res.error) throw new Error(res.error.message || 'Database error');
  return res.data ?? [];
};

export async function authorizeTenantSignIn(
  tenantId: TenantId,
  input: { email: string; emailVerified: boolean; name?: string | null },
): Promise<boolean> {
  const email = normalizeEmail(input.email);
  if (!email) return false;

  const invites = must<InviteRow>(await query(
    `SELECT i."id", i."spaceId", i."email", i."role", i."expiresAt", i."acceptedAt"
       FROM "SpaceInvite" i JOIN "Space" s ON s."id" = i."spaceId"
      WHERE s."tenantId" = $1 AND i."email" = $2 AND i."acceptedAt" IS NULL`,
    [tenantId, email],
  ));
  const rules = must<AccessRuleRow>(await query(
    `SELECT r."spaceId", r."kind", r."value", r."role"
       FROM "SpaceAccessRule" r JOIN "Space" s ON s."id" = r."spaceId"
      WHERE s."tenantId" = $1
        AND ((r."kind" = 'email' AND r."value" = $2) OR (r."kind" = 'domain' AND r."value" = $3))`,
    [tenantId, email, emailDomain(email)],
  ));

  let userId = await resolveUserIdByEmail(email);
  const isMember = userId
    ? must(await query(
        `SELECT 1 FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
          WHERE s."tenantId" = $1 AND m."userId" = $2 LIMIT 1`,
        [tenantId, userId],
      )).length > 0
    : false;

  const decision = decideSpaceAccess({
    email, emailVerified: input.emailVerified, now: new Date(), isMember, invites, rules,
  });
  if (!decision.allowed) {
    console.warn(`[TENANT-SIGNIN] ${tenantId} rejected ${email}: ${decision.reason}`);
    return false;
  }

  if (decision.grants.length > 0) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      if (!userId) {
        // New person: provision a minimal User. User.role grants nothing outside musiki.
        const created = await client.query(
          `INSERT INTO "User" ("id", "email", "name", "role", "emailVerified", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, 'student', true, now(), now()) RETURNING "id"`,
          [email, input.name ?? null],
        );
        userId = created.rows[0].id;
        await client.query(
          `INSERT INTO "UserEmail" ("userId", "email", "isPrimary") VALUES ($1, $2, true)`,
          [userId, email],
        );
      }

      for (const grant of decision.grants) {
        await client.query(
          `INSERT INTO "SpaceMember" ("spaceId", "userId", "role") VALUES ($1, $2, $3)
           ON CONFLICT ("spaceId", "userId") DO NOTHING`,
          [grant.spaceId, userId, grant.role],
        );
        if (grant.inviteId) {
          await client.query(
            `UPDATE "SpaceInvite" SET "acceptedAt" = now() WHERE "id" = $1 AND "acceptedAt" IS NULL`,
            [grant.inviteId],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`[TENANT-SIGNIN] ${tenantId} provisioning error for ${email}:`, err);
      return false;
    } finally {
      client.release();
    }
  }
  console.log(`[TENANT-SIGNIN] ${tenantId} allowed ${email} (${decision.grants.length} new grants)`);
  return true;
}

/**
 * True when the user exists only because another tenant provisioned them
 * (see shouldRejectMusikiSignIn). Fails open: on any DB error (e.g. the Space
 * tables are not migrated yet) it logs and returns false so musiki sign-in
 * never depends on the tenant tables.
 */
export async function isForeignTenantOnlyUser(userId: string): Promise<boolean> {
  try {
    const rows = must<{ role: string | null; hasEnrollment: boolean; hasForeignMembership: boolean }>(await query(
      `SELECT u."role",
              EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."userId" = u."id") AS "hasEnrollment",
              EXISTS (SELECT 1 FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
                       WHERE m."userId" = u."id" AND s."tenantId" <> $2) AS "hasForeignMembership"
         FROM "User" u WHERE u."id" = $1`,
      [userId, DEFAULT_TENANT_ID],
    ));
    const row = rows[0];
    if (!row) return false;
    return shouldRejectMusikiSignIn({
      hasEnrollment: Boolean(row.hasEnrollment),
      globalRole: row.role,
      hasForeignMembership: Boolean(row.hasForeignMembership),
    });
  } catch (err) {
    console.error('[AUTH-SIGNIN] foreign-tenant check failed, allowing musiki sign-in:', err);
    return false;
  }
}
