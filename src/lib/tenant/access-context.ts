import type { SpaceInfo } from './access.ts';

type Q = (text: string, params?: any[]) => Promise<{ data: any[] | null; error: any }>;

export const SPACES_SQL = `SELECT s."id", s."kind", COALESCE(s."settings" -> 'openJoin' = 'true'::jsonb, false) AS "openJoin"
       FROM "Space" s WHERE s."tenantId" = $1`;
export const BLOCKS_SQL = `SELECT b."spaceId" FROM "SpaceMemberBlock" b JOIN "Space" s ON s."id" = b."spaceId"
          WHERE s."tenantId" = $1 AND b."userId" = $2`;

const MISSING_SCHEMA = new Set(['42703', '42P01']);
let warned = false;

/**
 * Loads per-space kind/openJoin and the user's blocked spaces. If the schema is
 * not migrated yet (undefined column/table) it falls back to no spaces and no
 * blocks so tenant sign-in never depends on migration order. Other errors throw.
 * Kinds other than 'commons' map to dissertation rules.
 */
export async function loadSpaceAccessContext(q: Q, tenantId: string, userId: string | null):
  Promise<{ spaces: SpaceInfo[]; blockedSpaceIds: string[] }> {
  try {
    const res = await q(SPACES_SQL, [tenantId]);
    if (res.error) throw res.error;
    const spaces = (res.data ?? []).map((r): SpaceInfo => ({
      id: r.id, kind: r.kind === 'commons' ? 'commons' : 'dissertation', openJoin: r.openJoin === true,
    }));
    let blockedSpaceIds: string[] = [];
    if (userId) {
      const b = await q(BLOCKS_SQL, [tenantId, userId]);
      if (b.error) throw b.error;
      blockedSpaceIds = (b.data ?? []).map((r) => r.spaceId);
    }
    return { spaces, blockedSpaceIds };
  } catch (err: any) {
    if (!MISSING_SCHEMA.has(err?.code)) throw err;
    if (!warned) { warned = true; console.warn(`[TENANT-SIGNIN] space settings/blocks schema missing (${err.code}); open-join disabled`); }
    return { spaces: [], blockedSpaceIds: [] };
  }
}
