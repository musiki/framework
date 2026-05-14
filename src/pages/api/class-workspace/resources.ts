import type { APIRoute } from 'astro';
import {
  cleanString,
  ensureDbUserFromSession,
  getForumCourseAccess,
  json,
} from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import {
  legacyFolderToWorkspaceNode,
  legacyResourceToAsset,
  legacyResourceToWorkspaceNode,
  legacySessionToWorkspaceNode,
  type ResourceAsset,
  type LegacyResourceRow,
  type LegacySessionRow,
  type WorkspaceNode,
} from '../../../lib/class-workspace';
import { ensureClassWorkspaceSchema } from '../../../lib/class-workspace/schema';

const resourceColumns = `
  id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
  "createdBy", "sortOrder", "createdAt"
`;

const sessionColumns = `id, "roomName", name, "courseId", "claseId", "createdAt"`;

const nodeColumns = `
  id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
  "ownerUserId", "createdByUserId", visibility, source, metadata, revision,
  "createdAt", "updatedAt", "deletedAt"
`;

const assetColumns = `
  id, "nodeId", mime, "resourceType", "objectKey", "externalUrl",
  "sizeBytes", sha256, "previewStatus", "uploadStatus"
`;

function folderParentId(row: LegacyResourceRow): string | null {
  return row.sessionId ? String(row.sessionId) : null;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120);
  if (!courseId) return json({ error: 'Missing courseId' }, 400);

  const courseAccess = await getForumCourseAccess(user, courseId);
  const manageAccess = await resolveLiveManageAccess(session, courseId);
  if (!courseAccess.canRead && !manageAccess.canManage) {
    return json({ error: 'Forbidden' }, 403);
  }

  let canonicalSchemaAvailable = true;
  try {
    await ensureClassWorkspaceSchema();
  } catch (error) {
    canonicalSchemaAvailable = false;
    console.warn('[class-workspace-resources] canonical schema unavailable; continuing with legacy resources only', error);
  }

  const stageRoomName = `${courseId}-stage`;
  const [resourceResult, sessionResult, canonicalNodesResult, canonicalAssetsResult] = await Promise.all([
    query<LegacyResourceRow>(
      `SELECT ${resourceColumns}
         FROM "LiveClassResource"
        WHERE "claseId" = $1
           OR "claseId" LIKE $2
           OR "roomName" = $3
        ORDER BY "roomName" ASC, "claseId" ASC NULLS FIRST, folder ASC, "sortOrder" ASC, "createdAt" ASC`,
      [courseId, `${courseId}/%`, stageRoomName],
    ),
    query<LegacySessionRow>(
      `SELECT ${sessionColumns}
         FROM "ResourceSession"
        WHERE "roomName" = $1
           OR "courseId" = $2
           OR "claseId" = $2
           OR "claseId" LIKE $3
        ORDER BY "createdAt" DESC
        LIMIT 100`,
      [stageRoomName, courseId, `${courseId}/%`],
    ),
    canonicalSchemaAvailable ? query<WorkspaceNode & { metadata?: unknown; revision?: string | number }>(
      `SELECT ${nodeColumns}
         FROM "ClassWorkspaceNode"
        WHERE "courseId" = $1
          AND "deletedAt" IS NULL
        ORDER BY "parentId" NULLS FIRST, "sortKey" ASC, "createdAt" ASC`,
      [courseId],
    ) : Promise.resolve({ data: [], error: null, count: 0 }),
    canonicalSchemaAvailable ? query<ResourceAsset>(
      `SELECT ${assetColumns}
         FROM "ClassResourceAsset"
        WHERE "nodeId" IN (
          SELECT id FROM "ClassWorkspaceNode"
           WHERE "courseId" = $1 AND "deletedAt" IS NULL
        )`,
      [courseId],
    ) : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);

  if (resourceResult.error) return json({ error: resourceResult.error.message }, 500);
  if (sessionResult.error) return json({ error: sessionResult.error.message }, 500);
  if (canonicalNodesResult.error) return json({ error: canonicalNodesResult.error.message }, 500);
  if (canonicalAssetsResult.error) return json({ error: canonicalAssetsResult.error.message }, 500);

  const nodeMap = new Map<string, WorkspaceNode>();
  const folderNodes = new Map<string, WorkspaceNode>();

  for (const row of canonicalNodesResult.data ?? []) {
    nodeMap.set(row.id, row);
  }

  for (const row of sessionResult.data ?? []) {
    const node = legacySessionToWorkspaceNode(row);
    if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
  }

  for (const row of resourceResult.data ?? []) {
    const parentId = folderParentId(row);
    const folder = String(row.folder ?? '').trim();
    let resourceParentId = parentId;

    if (folder) {
      const folderNode = legacyFolderToWorkspaceNode({
        courseId,
        roomName: row.roomName ?? stageRoomName,
        folder,
        parentId,
        createdAt: row.createdAt,
      });
      if (!folderNodes.has(folderNode.id)) {
        folderNodes.set(folderNode.id, folderNode);
        if (!nodeMap.has(folderNode.id)) nodeMap.set(folderNode.id, folderNode);
      }
      resourceParentId = folderNode.id;
    }

    const node = legacyResourceToWorkspaceNode(row, { courseId, parentId: resourceParentId });
    if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
  }

  const assetMap = new Map<string, ResourceAsset>();
  for (const asset of canonicalAssetsResult.data ?? []) {
    assetMap.set(asset.id, asset);
  }
  for (const asset of (resourceResult.data ?? []).map(legacyResourceToAsset)) {
    if (!assetMap.has(asset.id)) assetMap.set(asset.id, asset);
  }

  return json({
    mode: 'legacy-adapter',
    courseId,
    roomName: stageRoomName,
    canManage: Boolean(manageAccess.canManage || courseAccess.isTeacher),
    canContribute: Boolean(manageAccess.canManage || manageAccess.enrollmentRole),
    currentUserId: manageAccess.userId || user.id,
    nodes: Array.from(nodeMap.values()),
    assets: Array.from(assetMap.values()),
    revision: 0,
  });
};
