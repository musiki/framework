import type { AccessGrant, SpaceInfo } from './access.ts';

type Client = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/**
 * Inside the sign-in provisioning transaction: an accepted invite into a
 * commons space lifts an earlier removal's SpaceMemberBlock. Rule and
 * open-join grants never unblock (decideSpaceAccess skips blocked spaces for
 * them). Savepoint: a not-yet-migrated block table (42P01) must not abort
 * sign-in; any other error propagates. Returns whether a DELETE ran.
 */
export async function unblockOnInvite(client: Client, grant: AccessGrant, userId: string, spaces: SpaceInfo[]): Promise<boolean> {
  if (!grant.inviteId) return false;
  if (!spaces.some((sp) => sp.id === grant.spaceId && sp.kind === 'commons')) return false;
  await client.query('SAVEPOINT unblock');
  try {
    await client.query(`DELETE FROM "SpaceMemberBlock" WHERE "spaceId" = $1 AND "userId" = $2`, [grant.spaceId, userId]);
    await client.query('RELEASE SAVEPOINT unblock');
    return true;
  } catch (err: any) {
    if (err?.code !== '42P01') throw err;
    await client.query('ROLLBACK TO SAVEPOINT unblock');
    return false;
  }
}
