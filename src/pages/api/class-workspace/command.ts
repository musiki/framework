import type { APIRoute } from 'astro';
import {
  cleanString,
  ensureDbUserFromSession,
  json,
} from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { getR2PublicObjectUrl } from '../../../lib/r2';
import type { ResourceAssetType, UploadIntent, WorkspaceCommand } from '../../../lib/class-workspace';
import { ensureClassWorkspaceSchema } from '../../../lib/class-workspace/schema';
import { normalizeDbResourceType } from '../../../lib/live/resource-db-enums';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const resourceColumns = `
  id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
  "createdBy", "sortOrder", "createdAt"
`;

const nodeColumns = `
  id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
  "ownerUserId", "createdByUserId", visibility, source, metadata, revision,
  "createdAt", "updatedAt", "deletedAt"
`;

const assetColumns = `
  id, "nodeId", mime, "resourceType", "objectKey", "externalUrl",
  "sizeBytes", sha256, "previewStatus", "uploadStatus"
`;

const snapshotColumns = `
  id, "nodeId", "courseId", "roomName", "sessionId", name, layout, "podState",
  "createdByUserId", revision, "createdAt"
`;

const documentColumns = `
  id, "nodeId", "courseId", kind, title, slug, "bodyMd", "astJson",
  "frontmatterJson", version, "updatedByUserId", "createdAt", "updatedAt"
`;

const normalizeText = (value: unknown, max = 240): string => cleanString(String(value ?? ''), max);
const asUuid = (value: unknown): string | null => {
  const text = normalizeText(value, 80);
  return uuidPattern.test(text) ? text : null;
};

function safeKeySegment(value: unknown, fallback = 'file'): string {
  return normalizeText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    || fallback;
}

function fileExt(fileName: string): string {
  return fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'bin';
}

function nameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    return normalizeText(lastSegment ? decodeURIComponent(lastSegment) : parsed.hostname, 240) || parsed.hostname;
  } catch {
    return normalizeText(url, 240) || 'Link';
  }
}

function resourceTypeFromUpload(file: UploadIntent): ResourceAssetType {
  const ext = fileExt(file.fileName);
  const mime = normalizeText(file.mime, 160).toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['txt'].includes(ext)) return 'txt';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['ly', 'tex'].includes(ext)) return 'lilypond';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  return 'other';
}

function resourceTypeFromNameOrUrl(name: string, url: string): ResourceAssetType {
  const derived = resourceTypeFromUpload({
    id: 'link',
    fileName: name || nameFromUrl(url),
    mime: '',
    sizeBytes: 1,
  });
  return derived === 'other' ? 'link' : derived;
}

function buildWorkspaceObjectKey(input: {
  courseId: string;
  roomName: string;
  actorUserId: string;
  file: UploadIntent;
  nodeId: string;
}): string {
  const ext = fileExt(input.file.fileName);
  const originalName = input.file.fileName.replace(/\.[a-z0-9]+$/i, '');
  const safeCourse = safeKeySegment(input.courseId, 'course');
  const safeRoom = safeKeySegment(input.roomName, 'room');
  const safeUser = safeKeySegment(input.actorUserId, 'user');
  const safeName = safeKeySegment(originalName, 'file');
  return `class-workspace/${safeCourse}/${safeRoom}/${safeUser}-${safeName}-${input.nodeId}.${ext}`;
}

function encodeObjectKeyPath(objectKey: string): string {
  return objectKey
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function publicUrlForObjectKey(objectKey: string): string {
  return getR2PublicObjectUrl(objectKey) || `/api/forum/uploads/${encodeObjectKeyPath(objectKey)}`;
}

function assetTypeToLegacyResourceType(type: string): string {
  switch (type) {
    case 'pdf':
    case 'pptx':
    case 'audio':
    case 'video':
    case 'link':
      return type;
    case 'image':
      return 'img';
    case 'markdown':
      return 'md';
    case 'lilypond':
      return 'ly';
    default:
      return 'other';
  }
}

function documentKind(value: unknown): 'lesson' | 'assignment' | 'note' | 'concept' | 'lily_block' {
  const kind = normalizeText(value, 80);
  return kind === 'assignment' || kind === 'note' || kind === 'concept' || kind === 'lily_block'
    ? kind
    : 'lesson';
}

function slugFromTitle(value: unknown, fallback = 'document'): string {
  return safeKeySegment(value, fallback).replace(/\.+/g, '-');
}

function normalizeFrontmatter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function deriveDocumentTitle(bodyMd: string, fallback = 'Documento'): string {
  const heading = bodyMd.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return normalizeText(heading || fallback, 240) || fallback;
}

function parseLegacyFolderId(id: string): { courseId: string; parentId: string | null; folder: string } | null {
  if (!id.startsWith('legacy-folder:')) return null;
  const [, courseId, parentKey, ...folderParts] = id.split(':');
  const folder = folderParts.join(':');
  if (!courseId || !folder) return null;
  return {
    courseId,
    parentId: parentKey && parentKey !== 'root' ? parentKey : null,
    folder,
  };
}

function resourceBelongsToCourse(row: any, courseId: string): boolean {
  const claseId = normalizeText(row?.claseId);
  const roomName = normalizeText(row?.roomName);
  return (
    claseId === courseId ||
    claseId.startsWith(`${courseId}/`) ||
    roomName === `${courseId}-stage` ||
    roomName.startsWith(`${courseId}-`)
  );
}

function sessionBelongsToCourse(row: any, courseId: string): boolean {
  const sessionCourseId = normalizeText(row?.courseId);
  const claseId = normalizeText(row?.claseId);
  const roomName = normalizeText(row?.roomName);
  return (
    sessionCourseId === courseId ||
    claseId === courseId ||
    claseId.startsWith(`${courseId}/`) ||
    roomName === `${courseId}-stage` ||
    roomName.startsWith(`${courseId}-`)
  );
}

async function appendEvent(input: {
  courseId: string;
  roomName: string | null;
  type: string;
  actorUserId: string;
  payload: Record<string, unknown>;
}) {
  const result = await query<{ id: string; revision: string | number }>(
    `INSERT INTO "ClassWorkspaceEvent" ("courseId", "roomName", type, "actorUserId", payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, revision`,
    [
      input.courseId,
      input.roomName,
      input.type,
      input.actorUserId,
      JSON.stringify(input.payload),
    ],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function getCanonicalNode(id: string) {
  const result = await query<any>(
    `SELECT ${nodeColumns}
       FROM "ClassWorkspaceNode"
      WHERE id = $1 AND "deletedAt" IS NULL
      LIMIT 1`,
    [id],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function getLegacyResource(id: string) {
  const result = await query<any>(
    `SELECT ${resourceColumns}
       FROM "LiveClassResource"
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function getLegacySession(id: string) {
  const result = await query<any>(
    `SELECT id, "roomName", name, "courseId", "claseId", "createdAt"
       FROM "ResourceSession"
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function ensureSessionNode(input: {
  sessionId: string;
  courseId: string;
  roomName: string;
  actorUserId: string;
}) {
  const existingNode = await getCanonicalNode(input.sessionId);
  if (existingNode) return existingNode;

  const legacySession = await getLegacySession(input.sessionId);
  if (!legacySession) return null;

  const createdAt = legacySession.createdAt ? new Date(legacySession.createdAt).toISOString() : new Date().toISOString();
  const result = await query<any>(
    `INSERT INTO "ClassWorkspaceNode"
      (id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
       "ownerUserId", "createdByUserId", visibility, source, metadata, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'session', NULL, $4, NULL, $5, $6, $6, 'class', 'room', $7::jsonb, $8, now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           "updatedAt" = now(),
           "deletedAt" = NULL
     RETURNING ${nodeColumns}`,
    [
      input.sessionId,
      input.courseId,
      legacySession.roomName || input.roomName,
      legacySession.name || 'Sesion',
      createdAt,
      input.actorUserId,
      JSON.stringify({ legacyTable: 'ResourceSession' }),
      createdAt,
    ],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function updateLegacyFolderName(input: {
  courseId: string;
  oldFolder: string;
  newFolder: string;
  sessionId: string | null;
}) {
  if (!input.oldFolder || input.oldFolder === input.newFolder) return [];
  const result = await query<any>(
    `UPDATE "LiveClassResource"
        SET folder = $1
      WHERE folder = $2
        AND (("claseId" = $3 OR "claseId" LIKE $4 OR "roomName" = $5))
        AND (${input.sessionId ? '"sessionId" = $6' : '"sessionId" IS NULL'})
      RETURNING ${resourceColumns}`,
    input.sessionId
      ? [input.newFolder, input.oldFolder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`, input.sessionId]
      : [input.newFolder, input.oldFolder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
  );
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function clearLegacyFolder(input: {
  courseId: string;
  folder: string;
  sessionId: string | null;
}) {
  if (!input.folder) return [];
  const result = await query<any>(
    `UPDATE "LiveClassResource"
        SET folder = ''
      WHERE folder = $1
        AND (("claseId" = $2 OR "claseId" LIKE $3 OR "roomName" = $4))
        AND (${input.sessionId ? '"sessionId" = $5' : '"sessionId" IS NULL'})
      RETURNING ${resourceColumns}`,
    input.sessionId
      ? [input.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`, input.sessionId]
      : [input.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
  );
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function updateCanonicalMoveMirror(input: {
  courseId: string;
  nodeId: string;
  parentId: string | null;
  folder: string;
  sessionId: string | null;
}) {
  const result = await query<any>(
    `UPDATE "ClassWorkspaceNode"
        SET "parentId" = $1,
            metadata = COALESCE(metadata, '{}'::jsonb)
              || jsonb_build_object('legacyFolderName', $2::text, 'legacySessionId', $3::text),
            revision = revision + 1,
            "updatedAt" = now()
      WHERE id = $4 AND "courseId" = $5
      RETURNING ${nodeColumns}`,
    [input.parentId, input.folder, input.sessionId, input.nodeId, input.courseId],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function softDeleteCanonicalNode(input: { courseId: string; nodeId: string }) {
  const result = await query<any>(
    `UPDATE "ClassWorkspaceNode"
        SET "deletedAt" = now(),
            revision = revision + 1,
            "updatedAt" = now()
      WHERE id = $1 AND "courseId" = $2 AND "deletedAt" IS NULL
      RETURNING ${nodeColumns}`,
    [input.nodeId, input.courseId],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function detachSession(input: { courseId: string; sessionId: string }) {
  const legacyResources = await query<any>(
    `UPDATE "LiveClassResource"
        SET "sessionId" = NULL
      WHERE "sessionId" = $1
        AND (("claseId" = $2 OR "claseId" LIKE $3 OR "roomName" = $4))
      RETURNING ${resourceColumns}`,
    [input.sessionId, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
  );
  if (legacyResources.error) throw legacyResources.error;

  const workspaceChildren = await query<any>(
    `UPDATE "ClassWorkspaceNode"
        SET "parentId" = CASE WHEN "parentId" = $1::uuid THEN NULL ELSE "parentId" END,
            metadata = COALESCE(metadata, '{}'::jsonb) - 'legacySessionId',
            revision = revision + 1,
            "updatedAt" = now()
      WHERE "courseId" = $2
        AND "deletedAt" IS NULL
        AND ("parentId" = $1::uuid OR metadata->>'legacySessionId' = $1::text)
      RETURNING ${nodeColumns}`,
    [input.sessionId, input.courseId],
  );
  if (workspaceChildren.error) throw workspaceChildren.error;

  const snapshots = await query<any>(
    `UPDATE "ClassWorkspaceSnapshot"
        SET "sessionId" = NULL
      WHERE "courseId" = $2 AND "sessionId" = $1
      RETURNING ${snapshotColumns}`,
    [input.sessionId, input.courseId],
  );
  if (snapshots.error) throw snapshots.error;

  return {
    legacyResources: legacyResources.data ?? [],
    workspaceChildren: workspaceChildren.data ?? [],
    snapshots: snapshots.data ?? [],
  };
}

async function assertCanMutateOwnedNodes(input: {
  courseId: string;
  nodeIds: string[];
  actorUserId: string;
  canManage: boolean;
}) {
  if (input.canManage) return;
  for (const rawId of input.nodeIds) {
    const nodeId = normalizeText(rawId, 120);
    const legacyFolder = parseLegacyFolderId(nodeId);
    if (legacyFolder) throw new Error('Forbidden: folder belongs to class workspace');

    const canonicalId = asUuid(nodeId);
    if (!canonicalId) throw new Error('Forbidden: invalid node');

    const canonical = await getCanonicalNode(canonicalId);
    if (canonical) {
      const ownerId = normalizeText(canonical.ownerUserId, 120);
      const createdBy = normalizeText(canonical.createdByUserId, 120);
      if (canonical.courseId === input.courseId && (ownerId === input.actorUserId || createdBy === input.actorUserId)) {
        continue;
      }
      throw new Error('Forbidden: node belongs to another user');
    }

    const resource = await getLegacyResource(canonicalId);
    if (resource) {
      const createdBy = normalizeText(resource.createdBy, 120);
      if (resourceBelongsToCourse(resource, input.courseId) && createdBy === input.actorUserId) {
        continue;
      }
    }

    throw new Error('Forbidden: node not owned by current user');
  }
}

async function createFolder(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'folder.create' }>;
  actorUserId: string;
  canManage: boolean;
}) {
  const name = normalizeText(input.command.name, 160);
  if (!name) throw new Error('Folder name required');

  const parentUuid = asUuid(input.command.parentId);
  let parentId: string | null = null;
  let legacySessionId: string | null = null;

  if (parentUuid) {
    const parentNode = await getCanonicalNode(parentUuid);
    if (parentNode) {
      parentId = parentNode.id;
      legacySessionId = parentNode.kind === 'session'
        ? parentNode.id
        : normalizeText(parentNode.metadata?.legacySessionId) || null;
    } else {
      const sessionNode = await ensureSessionNode({
        sessionId: parentUuid,
        courseId: input.courseId,
        roomName: input.roomName,
        actorUserId: input.actorUserId,
      });
      if (sessionNode) {
        parentId = sessionNode.id;
        legacySessionId = sessionNode.id;
      }
    }
  }

  const result = await query<any>(
    `INSERT INTO "ClassWorkspaceNode"
      ("courseId", "roomName", kind, "parentId", name, slug, "sortKey",
       "ownerUserId", "createdByUserId", visibility, source, metadata)
     VALUES ($1, $2, 'folder', $3, $4, $5, $6, $7, $7, 'class', $8::"WorkspaceSource", $9::jsonb)
     RETURNING ${nodeColumns}`,
    [
      input.courseId,
      input.roomName,
      parentId,
      name,
      name,
      name,
      input.actorUserId,
      input.canManage ? 'musiki' : 'student',
      JSON.stringify({ legacyFolderName: name, legacySessionId }),
    ],
  );
  if (result.error) throw result.error;

  return result.data?.[0] ?? null;
}

async function createSession(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'session.create' }>;
  actorUserId: string;
}) {
  const name = normalizeText(input.command.name, 160);
  if (!name) throw new Error('Session name required');

  const claseId = normalizeText(input.command.claseId, 160) || input.courseId;
  const sessionResult = await query<any>(
    `INSERT INTO "ResourceSession" ("roomName", name, "courseId", "claseId")
     VALUES ($1, $2, $3, $4)
     RETURNING id, "roomName", name, "courseId", "claseId", "createdAt"`,
    [input.roomName, name, input.courseId, claseId],
  );
  if (sessionResult.error) throw sessionResult.error;

  const session = sessionResult.data?.[0] ?? null;
  if (!session?.id) throw new Error('Session was not created');

  const node = await ensureSessionNode({
    sessionId: session.id,
    courseId: input.courseId,
    roomName: input.roomName,
    actorUserId: input.actorUserId,
  });

  return { session, node };
}

async function renameNode(input: {
  courseId: string;
  command: Extract<WorkspaceCommand, { type: 'node.rename' }>;
}) {
  const nodeId = normalizeText(input.command.nodeId, 120);
  const name = normalizeText(input.command.name, 500);
  if (!nodeId || !name) throw new Error('nodeId and name required');

  const canonicalId = asUuid(nodeId);
  if (canonicalId) {
    const canonical = await getCanonicalNode(canonicalId);
    if (canonical) {
      const oldFolder = canonical.kind === 'folder'
        ? normalizeText(canonical.metadata?.legacyFolderName) || canonical.name
        : '';
      const oldSessionId = canonical.kind === 'folder'
        ? normalizeText(canonical.metadata?.legacySessionId) || (canonical.parentId ? String(canonical.parentId) : '')
        : '';
      const result = await query<any>(
        `UPDATE "ClassWorkspaceNode"
            SET name = $1,
                slug = CASE WHEN kind = 'folder' THEN $1 ELSE slug END,
                metadata = CASE
                  WHEN kind = 'folder' THEN jsonb_set(metadata, '{legacyFolderName}', to_jsonb($1::text), true)
                  ELSE metadata
                END,
                revision = revision + 1,
                "updatedAt" = now()
          WHERE id = $2 AND "courseId" = $3
          RETURNING ${nodeColumns}`,
        [name, canonicalId, input.courseId],
      );
      if (result.error) throw result.error;
      const legacyFolder = canonical.kind === 'folder'
        ? await updateLegacyFolderName({
            courseId: input.courseId,
            oldFolder,
            newFolder: name,
            sessionId: oldSessionId && asUuid(oldSessionId) ? oldSessionId : null,
          })
        : null;
      const legacyResource = canonical.kind === 'resource'
        ? await query<any>(
            `UPDATE "LiveClassResource"
                SET name = $1
              WHERE id = $2
                AND (("claseId" = $3 OR "claseId" LIKE $4 OR "roomName" = $5))
              RETURNING ${resourceColumns}`,
            [name, canonicalId, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
          )
        : null;
      if (legacyResource?.error) throw legacyResource.error;
      return {
        node: result.data?.[0] ?? null,
        legacy: legacyFolder ?? legacyResource?.data?.[0] ?? null,
      };
    }

    const resource = await getLegacyResource(canonicalId);
    if (resource) {
      if (!resourceBelongsToCourse(resource, input.courseId)) throw new Error('Resource is outside this course');
      const result = await query<any>(
        `UPDATE "LiveClassResource"
            SET name = $1
          WHERE id = $2
          RETURNING ${resourceColumns}`,
        [name, canonicalId],
      );
      if (result.error) throw result.error;
      return { node: null, legacy: result.data?.[0] ?? null };
    }

    const session = await getLegacySession(canonicalId);
    if (session) {
      const result = await query<any>(
        `UPDATE "ResourceSession"
            SET name = $1
          WHERE id = $2
          RETURNING id, "roomName", name, "courseId", "claseId", "createdAt"`,
        [name, canonicalId],
      );
      if (result.error) throw result.error;
      await query(
        `UPDATE "ClassWorkspaceNode"
            SET name = $1, revision = revision + 1, "updatedAt" = now()
          WHERE id = $2`,
        [name, canonicalId],
      );
      return { node: null, legacy: result.data?.[0] ?? null };
    }
  }

  const legacyFolder = parseLegacyFolderId(nodeId);
  if (legacyFolder && legacyFolder.courseId === input.courseId) {
    const sessionId = legacyFolder.parentId && asUuid(legacyFolder.parentId) ? legacyFolder.parentId : null;
    const result = await query<any>(
      `UPDATE "LiveClassResource"
          SET folder = $1
        WHERE folder = $2
          AND (("claseId" = $3 OR "claseId" LIKE $4 OR "roomName" = $5))
          AND (${sessionId ? '"sessionId" = $6' : '"sessionId" IS NULL'})
        RETURNING ${resourceColumns}`,
      sessionId
        ? [name, legacyFolder.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`, sessionId]
        : [name, legacyFolder.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
    );
    if (result.error) throw result.error;
    return { node: null, legacy: result.data ?? [] };
  }

  throw new Error('Node not found');
}

async function resolveMoveTarget(input: { courseId: string; targetParentId: string | null }) {
  if (!input.targetParentId) return { folder: '', sessionId: null as string | null, canonicalParentId: null as string | null };

  const legacyFolder = parseLegacyFolderId(input.targetParentId);
  if (legacyFolder && legacyFolder.courseId === input.courseId) {
    return {
      folder: legacyFolder.folder,
      sessionId: legacyFolder.parentId && asUuid(legacyFolder.parentId) ? legacyFolder.parentId : null,
      canonicalParentId: null,
    };
  }

  const targetUuid = asUuid(input.targetParentId);
  if (!targetUuid) throw new Error('Invalid targetParentId');

  const targetNode = await getCanonicalNode(targetUuid);
  if (targetNode) {
    if (targetNode.courseId !== input.courseId) throw new Error('Target is outside this course');
    if (targetNode.kind === 'folder') {
      const folder = normalizeText(targetNode.metadata?.legacyFolderName) || targetNode.name;
      const legacySessionId =
        normalizeText(targetNode.metadata?.legacySessionId) ||
        (targetNode.parentId ? String(targetNode.parentId) : '');
      return {
        folder,
        sessionId: legacySessionId && asUuid(legacySessionId) ? legacySessionId : null,
        canonicalParentId: targetNode.id,
      };
    }
    if (targetNode.kind === 'session') {
      return { folder: '', sessionId: targetNode.id, canonicalParentId: targetNode.id };
    }
    return { folder: '', sessionId: targetNode.id, canonicalParentId: targetNode.id };
  }

  const legacySession = await getLegacySession(targetUuid);
  if (legacySession) {
    return { folder: '', sessionId: targetUuid, canonicalParentId: null };
  }

  throw new Error('Target not found');
}

async function moveNodes(input: {
  courseId: string;
  command: Extract<WorkspaceCommand, { type: 'node.move' }>;
}) {
  const nodeIds = input.command.nodeIds.map((id) => normalizeText(id, 120)).filter(Boolean);
  if (nodeIds.length === 0) throw new Error('nodeIds required');

  const target = await resolveMoveTarget({
    courseId: input.courseId,
    targetParentId: input.command.targetParentId ?? null,
  });

  const moved: any[] = [];
  for (const nodeId of nodeIds) {
    const canonicalId = asUuid(nodeId);
    if (!canonicalId) continue;

    const resource = await getLegacyResource(canonicalId);
    if (resource) {
      if (!resourceBelongsToCourse(resource, input.courseId)) throw new Error('Resource is outside this course');
      const result = await query<any>(
        `UPDATE "LiveClassResource"
            SET folder = $1, "sessionId" = $2
          WHERE id = $3
          RETURNING ${resourceColumns}`,
        [target.folder, target.sessionId, canonicalId],
      );
      if (result.error) throw result.error;
      const node = await updateCanonicalMoveMirror({
        courseId: input.courseId,
        nodeId: canonicalId,
        parentId: target.canonicalParentId,
        folder: target.folder,
        sessionId: target.sessionId,
      });
      moved.push({ legacy: result.data?.[0] ?? null, node });
      continue;
    }

    const canonical = await getCanonicalNode(canonicalId);
    if (canonical) {
      const node = await updateCanonicalMoveMirror({
        courseId: input.courseId,
        nodeId: canonicalId,
        parentId: target.canonicalParentId,
        folder: canonical.kind === 'folder'
          ? normalizeText(canonical.metadata?.legacyFolderName) || canonical.name
          : target.folder,
        sessionId: target.sessionId,
      });
      moved.push(node);
    }
  }

  return moved;
}

async function deleteNodes(input: {
  courseId: string;
  command: Extract<WorkspaceCommand, { type: 'node.delete' }>;
}) {
  const nodeIds = input.command.nodeIds.map((id) => normalizeText(id, 120)).filter(Boolean);
  if (nodeIds.length === 0) throw new Error('nodeIds required');

  const deleted: any[] = [];
  for (const nodeId of nodeIds) {
    const legacyFolder = parseLegacyFolderId(nodeId);
    if (legacyFolder && legacyFolder.courseId === input.courseId) {
      const sessionId = legacyFolder.parentId && asUuid(legacyFolder.parentId) ? legacyFolder.parentId : null;
      const result = await query<any>(
        `UPDATE "LiveClassResource"
            SET folder = ''
          WHERE folder = $1
            AND (("claseId" = $2 OR "claseId" LIKE $3 OR "roomName" = $4))
            AND (${sessionId ? '"sessionId" = $5' : '"sessionId" IS NULL'})
          RETURNING ${resourceColumns}`,
        sessionId
          ? [legacyFolder.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`, sessionId]
          : [legacyFolder.folder, input.courseId, `${input.courseId}/%`, `${input.courseId}-stage`],
      );
      if (result.error) throw result.error;
      deleted.push(...(result.data ?? []));
      continue;
    }

    const canonicalId = asUuid(nodeId);
    if (!canonicalId) continue;

    const resource = await getLegacyResource(canonicalId);
    if (resource) {
      if (!resourceBelongsToCourse(resource, input.courseId)) throw new Error('Resource is outside this course');
      const result = await query<any>(
        `DELETE FROM "LiveClassResource"
          WHERE id = $1
          RETURNING ${resourceColumns}`,
        [canonicalId],
      );
      if (result.error) throw result.error;
      const node = await softDeleteCanonicalNode({ courseId: input.courseId, nodeId: canonicalId });
      deleted.push({ legacy: result.data?.[0] ?? null, node });
      continue;
    }

    const session = await getLegacySession(canonicalId);
    if (session) {
      if (!sessionBelongsToCourse(session, input.courseId)) throw new Error('Session is outside this course');
      const detached = await detachSession({ courseId: input.courseId, sessionId: canonicalId });
      const sessionResult = await query<any>(
        `DELETE FROM "ResourceSession"
          WHERE id = $1
          RETURNING id, "roomName", name, "courseId", "claseId", "createdAt"`,
        [canonicalId],
      );
      if (sessionResult.error) throw sessionResult.error;
      const node = await softDeleteCanonicalNode({ courseId: input.courseId, nodeId: canonicalId });
      deleted.push({
        legacySession: sessionResult.data?.[0] ?? null,
        node,
        detached,
      });
      continue;
    }

    const canonical = await getCanonicalNode(canonicalId);
    if (canonical) {
      if (canonical.kind === 'session') {
        const detached = await detachSession({ courseId: input.courseId, sessionId: canonicalId });
        const node = await softDeleteCanonicalNode({ courseId: input.courseId, nodeId: canonicalId });
        deleted.push({ node, detached });
        continue;
      }
      const folder = canonical.kind === 'folder'
        ? normalizeText(canonical.metadata?.legacyFolderName) || canonical.name
        : '';
      const legacySessionId = canonical.kind === 'folder'
        ? normalizeText(canonical.metadata?.legacySessionId) || (canonical.parentId ? String(canonical.parentId) : '')
        : '';
      if (folder) {
        const cleared = await clearLegacyFolder({
          courseId: input.courseId,
          folder,
          sessionId: legacySessionId && asUuid(legacySessionId) ? legacySessionId : null,
        });
        deleted.push(...cleared);
      }
      const node = await softDeleteCanonicalNode({ courseId: input.courseId, nodeId: canonicalId });
      deleted.push(node);
    }
  }

  return deleted;
}

async function createResourceLink(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'resource.link.create' }>;
  actorUserId: string;
  canManage: boolean;
}) {
  const rawUrl = normalizeText(input.command.url, 2000);
  if (!rawUrl) throw new Error('url required');

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are supported');

  const target = await resolveMoveTarget({
    courseId: input.courseId,
    targetParentId: input.command.parentId ?? null,
  });

  const publicUrl = url.toString();
  const name = normalizeText(input.command.name, 500) || nameFromUrl(publicUrl);
  const nodeId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const resourceType = resourceTypeFromNameOrUrl(name, publicUrl);
  const legacyType = await normalizeDbResourceType(assetTypeToLegacyResourceType(resourceType));

  const nodeResult = await query<any>(
    `INSERT INTO "ClassWorkspaceNode"
      (id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
       "ownerUserId", "createdByUserId", visibility, source, metadata)
     VALUES ($1, $2, $3, 'resource', $4, $5, NULL, $6, $7, $7, 'class', $8::"WorkspaceSource", $9::jsonb)
     RETURNING ${nodeColumns}`,
    [
      nodeId,
      input.courseId,
      input.roomName,
      target.canonicalParentId,
      name,
      new Date().toISOString(),
      input.actorUserId,
      input.canManage ? 'musiki' : 'student',
      JSON.stringify({
        externalUrl: publicUrl,
        legacyFolderName: target.folder,
        legacySessionId: target.sessionId,
      }),
    ],
  );
  if (nodeResult.error) throw nodeResult.error;

  const assetResult = await query<any>(
     `INSERT INTO "ClassResourceAsset"
      (id, "nodeId", mime, "resourceType", "objectKey", "externalUrl",
       "sizeBytes", sha256, "previewStatus", "uploadStatus", preview)
     VALUES ($1, $2, '', $3::"ClassResourceAssetType", NULL, $4, NULL, NULL,
             'none'::"ResourcePreviewStatus", 'ready'::"ResourceUploadStatus", '{}'::jsonb)
     RETURNING ${assetColumns}`,
    [assetId, nodeId, resourceType, publicUrl],
  );
  if (assetResult.error) throw assetResult.error;

  const maxOrder = await query<{ nextOrder: number }>(
    `SELECT COALESCE(MAX("sortOrder") + 1, 0) AS "nextOrder"
       FROM "LiveClassResource"
      WHERE "roomName" = $1`,
    [input.roomName],
  );
  if (maxOrder.error) throw maxOrder.error;

  const legacyResult = await query<any>(
    `INSERT INTO "LiveClassResource"
      (id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
       "createdBy", "sortOrder", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"ResourceType", $8, 'upload'::"ResourceSource",
             $9, $10, now())
     ON CONFLICT (id) DO UPDATE
       SET url = EXCLUDED.url,
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           folder = EXCLUDED.folder,
           "sessionId" = EXCLUDED."sessionId"
     RETURNING ${resourceColumns}`,
    [
      nodeId,
      input.courseId,
      target.sessionId,
      input.roomName,
      publicUrl,
      name,
      legacyType,
      target.folder,
      input.actorUserId,
      Number(maxOrder.data?.[0]?.nextOrder ?? 0),
    ],
  );
  if (legacyResult.error) throw legacyResult.error;

  return {
    node: nodeResult.data?.[0] ?? null,
    asset: assetResult.data?.[0] ?? null,
    legacyResource: legacyResult.data?.[0] ?? null,
  };
}

async function prepareResourceUpload(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'resource.upload.prepare' }>;
  actorUserId: string;
  canManage: boolean;
}) {
  const files = Array.isArray(input.command.files) ? input.command.files : [];
  if (files.length === 0) throw new Error('files required');

  const target = await resolveMoveTarget({
    courseId: input.courseId,
    targetParentId: input.command.parentId ?? null,
  });

  const prepared: any[] = [];
  for (const rawFile of files) {
    const file: UploadIntent = {
      id: normalizeText(rawFile.id, 120) || crypto.randomUUID(),
      fileName: normalizeText(rawFile.fileName, 500) || 'upload.bin',
      mime: normalizeText(rawFile.mime, 160) || 'application/octet-stream',
      sizeBytes: Math.max(0, Number(rawFile.sizeBytes) || 0),
      sha256: rawFile.sha256 ? normalizeText(rawFile.sha256, 160) : null,
    };

    if (file.sizeBytes <= 0) throw new Error(`${file.fileName} is empty`);

    const nodeId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const objectKey = buildWorkspaceObjectKey({
      courseId: input.courseId,
      roomName: input.roomName,
      actorUserId: input.actorUserId,
      file,
      nodeId,
    });
    const publicUrl = publicUrlForObjectKey(objectKey);
    const resourceType = resourceTypeFromUpload(file);

    const nodeResult = await query<any>(
      `INSERT INTO "ClassWorkspaceNode"
        (id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
         "ownerUserId", "createdByUserId", visibility, source, metadata)
       VALUES ($1, $2, $3, 'resource', $4, $5, NULL, $6, $7, $7, 'class', $8::"WorkspaceSource", $9::jsonb)
       RETURNING ${nodeColumns}`,
      [
        nodeId,
        input.courseId,
        input.roomName,
        target.canonicalParentId,
        file.fileName,
        new Date().toISOString(),
        input.actorUserId,
        input.canManage ? 'musiki' : 'student',
        JSON.stringify({
          uploadIntentId: file.id,
          objectKey,
          legacyFolderName: target.folder,
          legacySessionId: target.sessionId,
        }),
      ],
    );
    if (nodeResult.error) throw nodeResult.error;

    const assetResult = await query<any>(
      `INSERT INTO "ClassResourceAsset"
        (id, "nodeId", mime, "resourceType", "objectKey", "externalUrl",
         "sizeBytes", sha256, "previewStatus", "uploadStatus", preview)
       VALUES ($1, $2, $3, $4::"ClassResourceAssetType", $5, NULL, $6, $7,
               'pending'::"ResourcePreviewStatus", 'pending'::"ResourceUploadStatus", $8::jsonb)
       RETURNING ${assetColumns}`,
      [
        assetId,
        nodeId,
        file.mime,
        resourceType,
        objectKey,
        file.sizeBytes,
        file.sha256,
        JSON.stringify({ expectedPublicUrl: publicUrl }),
      ],
    );
    if (assetResult.error) throw assetResult.error;

    prepared.push({
      uploadId: assetId,
      nodeId,
      assetId,
      objectKey,
      publicUrl,
      method: 'r2-object-key',
      file,
      node: nodeResult.data?.[0] ?? null,
      asset: assetResult.data?.[0] ?? null,
    });
  }

  return prepared;
}

async function completeResourceUpload(input: {
  courseId: string;
  command: Extract<WorkspaceCommand, { type: 'resource.upload.complete' }>;
  actorUserId: string;
  canManage: boolean;
}) {
  const uploadId = asUuid(input.command.uploadId);
  if (!uploadId) throw new Error('uploadId required');

  const objectKey = normalizeText(input.command.objectKey, 1000);
  if (!objectKey) throw new Error('objectKey required');

  const publicUrl = publicUrlForObjectKey(objectKey);
  const result = await query<any>(
    `UPDATE "ClassResourceAsset" asset
        SET "objectKey" = $1,
            "externalUrl" = $2,
            "uploadStatus" = 'ready'::"ResourceUploadStatus",
            "previewStatus" = CASE
              WHEN asset."previewStatus" = 'none'::"ResourcePreviewStatus" THEN 'none'::"ResourcePreviewStatus"
              ELSE 'pending'::"ResourcePreviewStatus"
            END,
            "updatedAt" = now()
       FROM "ClassWorkspaceNode" node
      WHERE asset.id = $3
        AND asset."nodeId" = node.id
        AND node."courseId" = $4
        AND ($5::boolean OR node."ownerUserId" = $6 OR node."createdByUserId" = $6)
      RETURNING asset.id, asset."nodeId", asset.mime, asset."resourceType", asset."objectKey",
                asset."externalUrl", asset."sizeBytes", asset.sha256, asset."previewStatus",
                asset."uploadStatus"`,
    [objectKey, publicUrl, uploadId, input.courseId, input.canManage, input.actorUserId],
  );
  if (result.error) throw result.error;
  const asset = result.data?.[0];
  if (!asset) throw new Error('Upload not found');

  const nodeResult = await query<any>(
    `UPDATE "ClassWorkspaceNode"
        SET revision = revision + 1,
            "updatedAt" = now(),
            metadata = jsonb_set(metadata, '{objectKey}', to_jsonb($1::text), true)
      WHERE id = $2 AND "courseId" = $3
      RETURNING ${nodeColumns}`,
    [objectKey, asset.nodeId, input.courseId],
  );
  if (nodeResult.error) throw nodeResult.error;

  const node = nodeResult.data?.[0] ?? null;
  const legacyResource = node
    ? await mirrorCompletedUploadToLegacy({
        courseId: input.courseId,
        node,
        asset,
        publicUrl,
      })
    : null;

  return {
    asset,
    node,
    legacyResource,
    publicUrl,
  };
}

async function mirrorCompletedUploadToLegacy(input: {
  courseId: string;
  node: any;
  asset: any;
  publicUrl: string;
}) {
  const metadata = input.node?.metadata && typeof input.node.metadata === 'object' ? input.node.metadata : {};
  const folder = normalizeText((metadata as any).legacyFolderName, 120);
  const sessionId = asUuid((metadata as any).legacySessionId) || null;
  const roomName = normalizeText(input.node?.roomName, 120) || `${input.courseId}-stage`;
  const legacyType = await normalizeDbResourceType(
    assetTypeToLegacyResourceType(String(input.asset?.resourceType || 'other')),
  );
  const source = 'upload';

  const maxOrder = await query<{ nextOrder: number }>(
    `SELECT COALESCE(MAX("sortOrder") + 1, 0) AS "nextOrder"
       FROM "LiveClassResource"
      WHERE "roomName" = $1`,
    [roomName],
  );
  if (maxOrder.error) throw maxOrder.error;

  const result = await query<any>(
    `INSERT INTO "LiveClassResource"
      (id, "claseId", "sessionId", "roomName", url, name, type, folder, source,
       "createdBy", "sortOrder", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"ResourceType", $8, $9::"ResourceSource",
             $10, $11, now())
     ON CONFLICT (id) DO UPDATE
       SET url = EXCLUDED.url,
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           folder = EXCLUDED.folder,
           source = EXCLUDED.source,
           "sessionId" = EXCLUDED."sessionId"
     RETURNING ${resourceColumns}`,
    [
      input.node.id,
      input.courseId,
      sessionId,
      roomName,
      input.publicUrl,
      normalizeText(input.node.name, 500) || input.publicUrl,
      legacyType,
      folder,
      source,
      normalizeText(input.node.createdByUserId, 120),
      Number(maxOrder.data?.[0]?.nextOrder ?? 0),
    ],
  );
  if (result.error) throw result.error;
  return result.data?.[0] ?? null;
}

async function createSnapshot(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'snapshot.create' }>;
  actorUserId: string;
}) {
  const name = normalizeText(input.command.name, 200) || new Date().toLocaleString();
  const requestedSessionId = asUuid(input.command.sessionId);
  const sessionId = requestedSessionId && await getLegacySession(requestedSessionId)
    ? requestedSessionId
    : null;
  const layout = input.command.layout ?? {};
  const podState = input.command.podState ?? {};
  const nodeId = crypto.randomUUID();

  if (sessionId) {
    await ensureSessionNode({
      sessionId,
      courseId: input.courseId,
      roomName: input.roomName,
      actorUserId: input.actorUserId,
    });
  }

  const nodeResult = await query<any>(
    `INSERT INTO "ClassWorkspaceNode"
      (id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
       "ownerUserId", "createdByUserId", visibility, source, metadata)
     VALUES ($1, $2, $3, 'snapshot', $4, $5, NULL, $6, $7, $7, 'class', 'room', $8::jsonb)
     RETURNING ${nodeColumns}`,
    [
      nodeId,
      input.courseId,
      input.roomName,
      sessionId,
      name,
      new Date().toISOString(),
      input.actorUserId,
      JSON.stringify({ legacyMirror: 'RoomSnapshot' }),
    ],
  );
  if (nodeResult.error) throw nodeResult.error;

  const snapshotResult = await query<any>(
    `INSERT INTO "ClassWorkspaceSnapshot"
      (id, "nodeId", "courseId", "roomName", "sessionId", name, layout, "podState", "createdByUserId")
     VALUES ($1, $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     RETURNING ${snapshotColumns}`,
    [
      nodeId,
      input.courseId,
      input.roomName,
      sessionId,
      name,
      JSON.stringify(layout),
      JSON.stringify(podState),
      input.actorUserId,
    ],
  );
  if (snapshotResult.error) throw snapshotResult.error;

  const legacyResult = await query<any>(
    `INSERT INTO "RoomSnapshot" (id, "roomName", "courseId", "claseId", name, layout, "createdBy")
     VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           layout = EXCLUDED.layout,
           "courseId" = EXCLUDED."courseId",
           "roomName" = EXCLUDED."roomName"
     RETURNING id, "roomName", name, layout, "createdBy", "createdAt"`,
    [
      nodeId,
      input.roomName,
      input.courseId,
      name,
      JSON.stringify(layout),
      input.actorUserId,
    ],
  );
  if (legacyResult.error) throw legacyResult.error;

  return {
    node: nodeResult.data?.[0] ?? null,
    snapshot: snapshotResult.data?.[0] ?? null,
    legacySnapshot: legacyResult.data?.[0] ?? null,
  };
}

async function restoreSnapshot(input: {
  courseId: string;
  command: Extract<WorkspaceCommand, { type: 'snapshot.restore' }>;
}) {
  const snapshotId = asUuid(input.command.snapshotId);
  if (!snapshotId) throw new Error('snapshotId required');

  const canonical = await query<any>(
    `SELECT ${snapshotColumns}
       FROM "ClassWorkspaceSnapshot"
      WHERE id = $1 AND "courseId" = $2
      LIMIT 1`,
    [snapshotId, input.courseId],
  );
  if (canonical.error) throw canonical.error;
  if (canonical.data?.[0]) {
    return {
      mode: 'canonical',
      snapshot: canonical.data[0],
      layout: canonical.data[0].layout ?? {},
      podState: canonical.data[0].podState ?? {},
    };
  }

  const legacy = await query<any>(
    `SELECT id, "roomName", "courseId", "claseId", name, layout, "createdBy", "createdAt"
       FROM "RoomSnapshot"
      WHERE id = $1
        AND ("courseId" = $2 OR "roomName" = $3)
      LIMIT 1`,
    [snapshotId, input.courseId, `${input.courseId}-stage`],
  );
  if (legacy.error) throw legacy.error;
  const legacySnapshot = legacy.data?.[0];
  if (!legacySnapshot) throw new Error('Snapshot not found');

  return {
    mode: 'legacy',
    snapshot: legacySnapshot,
    layout: legacySnapshot.layout ?? {},
    podState: {},
  };
}

async function updateDocument(input: {
  courseId: string;
  roomName: string;
  command: Extract<WorkspaceCommand, { type: 'document.update' }>;
  actorUserId: string;
}) {
  const documentId = asUuid(input.command.documentId);
  const requestedNodeId = asUuid(input.command.nodeId);
  const parentId = asUuid(input.command.parentId);
  const bodyMd = String(input.command.bodyMd ?? '');
  const kind = documentKind(input.command.kind);
  const title = normalizeText(input.command.title, 240) || deriveDocumentTitle(bodyMd);
  const slug = normalizeText(input.command.slug, 160) || slugFromTitle(title);
  const frontmatter = {
    ...normalizeFrontmatter(input.command.frontmatter),
    musiki_id: documentId || requestedNodeId || undefined,
    kind,
    course_id: input.courseId,
    slug,
    title,
  };

  let existingDocument: any = null;
  if (documentId) {
    const found = await query<any>(
      `SELECT ${documentColumns}
         FROM "CourseTextDocument"
        WHERE id = $1 AND "courseId" = $2
        LIMIT 1`,
      [documentId, input.courseId],
    );
    if (found.error) throw found.error;
    existingDocument = found.data?.[0] ?? null;
  }

  if (!existingDocument && requestedNodeId) {
    const found = await query<any>(
      `SELECT ${documentColumns}
         FROM "CourseTextDocument"
        WHERE "nodeId" = $1 AND "courseId" = $2
        LIMIT 1`,
      [requestedNodeId, input.courseId],
    );
    if (found.error) throw found.error;
    existingDocument = found.data?.[0] ?? null;
  }

  const baseVersion = Number(input.command.baseVersion || 0) || null;
  if (existingDocument && baseVersion && Number(existingDocument.version) !== baseVersion) {
    const error: any = new Error(`Version conflict: current=${existingDocument.version}, base=${baseVersion}`);
    error.status = 409;
    throw error;
  }

  const nodeId = existingDocument?.nodeId || requestedNodeId || crypto.randomUUID();
  const docId = existingDocument?.id || documentId || crypto.randomUUID();

  const nodeResult = await query<any>(
    `INSERT INTO "ClassWorkspaceNode"
      (id, "courseId", "roomName", kind, "parentId", name, slug, "sortKey",
       "ownerUserId", "createdByUserId", visibility, source, metadata)
     VALUES ($1, $2, $3, $4::"WorkspaceNodeKind", $5, $6, $7, $8, $9, $9, 'class', 'musiki', $10::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           slug = EXCLUDED.slug,
           kind = EXCLUDED.kind,
           "parentId" = COALESCE(EXCLUDED."parentId", "ClassWorkspaceNode"."parentId"),
           metadata = EXCLUDED.metadata,
           revision = "ClassWorkspaceNode".revision + 1,
           "updatedAt" = now(),
           "deletedAt" = NULL
     RETURNING ${nodeColumns}`,
    [
      nodeId,
      input.courseId,
      input.roomName,
      kind,
      parentId,
      title,
      slug,
      slug,
      input.actorUserId,
      JSON.stringify({
        documentId: docId,
        mirror: 'markdown-yaml',
      }),
    ],
  );
  if (nodeResult.error) throw nodeResult.error;

  const nextVersion = existingDocument ? Number(existingDocument.version || 0) + 1 : 1;
  const documentResult = await query<any>(
    `INSERT INTO "CourseTextDocument"
      (id, "nodeId", "courseId", kind, title, slug, "bodyMd", "frontmatterJson",
       version, "updatedByUserId")
     VALUES ($1, $2, $3, $4::"WorkspaceNodeKind", $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT (id) DO UPDATE
       SET "nodeId" = EXCLUDED."nodeId",
           kind = EXCLUDED.kind,
           title = EXCLUDED.title,
           slug = EXCLUDED.slug,
           "bodyMd" = EXCLUDED."bodyMd",
           "frontmatterJson" = EXCLUDED."frontmatterJson",
           version = EXCLUDED.version,
           "updatedByUserId" = EXCLUDED."updatedByUserId",
           "updatedAt" = now()
     RETURNING ${documentColumns}`,
    [
      docId,
      nodeId,
      input.courseId,
      kind,
      title,
      slug,
      bodyMd,
      JSON.stringify(frontmatter),
      nextVersion,
      input.actorUserId,
    ],
  );
  if (documentResult.error) throw documentResult.error;

  const versionResult = await query<any>(
    `INSERT INTO "CourseTextDocumentVersion"
      ("documentId", version, "bodyMd", patch, "frontmatterJson", source, "updatedByUserId")
     VALUES ($1, $2, $3, NULL, $4::jsonb, 'musiki', $5)
     ON CONFLICT ("documentId", version) DO NOTHING
     RETURNING id, "documentId", version, "createdAt"`,
    [
      docId,
      nextVersion,
      bodyMd,
      JSON.stringify(frontmatter),
      input.actorUserId,
    ],
  );
  if (versionResult.error) throw versionResult.error;

  return {
    node: nodeResult.data?.[0] ?? null,
    document: documentResult.data?.[0] ?? null,
    version: versionResult.data?.[0] ?? null,
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId, 120);
  if (!courseId) return json({ error: 'Missing courseId' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  const canContribute = Boolean(access.canManage || access.enrollmentRole);
  if (!canContribute) return json({ error: 'Forbidden' }, 403);

  const roomName = normalizeText(body?.roomName, 120) || `${courseId}-stage`;
  const command = body?.command as WorkspaceCommand | undefined;
  if (!command?.type) return json({ error: 'Missing command' }, 400);

  try {
    await ensureClassWorkspaceSchema();

    let result: unknown = null;
    let eventType: string = command.type;
    const requireTeacher = () => {
      if (!access.canManage) throw new Error('Forbidden: teacher permission required');
    };

    switch (command.type) {
      case 'session.create':
        requireTeacher();
        result = await createSession({
          courseId,
          roomName,
          command,
          actorUserId: access.userId,
        });
        eventType = 'session.created';
        break;
      case 'folder.create':
        result = await createFolder({
          courseId,
          roomName,
          command,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        eventType = 'node.created';
        break;
      case 'node.rename':
        await assertCanMutateOwnedNodes({
          courseId,
          nodeIds: [command.nodeId],
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        result = await renameNode({ courseId, command });
        eventType = 'node.renamed';
        break;
      case 'node.move':
        await assertCanMutateOwnedNodes({
          courseId,
          nodeIds: command.nodeIds,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        result = await moveNodes({ courseId, command });
        eventType = 'node.moved';
        break;
      case 'node.delete':
        await assertCanMutateOwnedNodes({
          courseId,
          nodeIds: command.nodeIds,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        result = await deleteNodes({ courseId, command });
        eventType = 'node.deleted';
        break;
      case 'resource.link.create':
        result = await createResourceLink({
          courseId,
          roomName,
          command,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        eventType = 'resource.link.created';
        break;
      case 'resource.upload.prepare':
        result = await prepareResourceUpload({
          courseId,
          roomName,
          command,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        eventType = 'resource.upload.prepared';
        break;
      case 'resource.upload.complete':
        result = await completeResourceUpload({
          courseId,
          command,
          actorUserId: access.userId,
          canManage: access.canManage,
        });
        eventType = 'asset.ready';
        break;
      case 'snapshot.create':
        result = await createSnapshot({ courseId, roomName, command, actorUserId: access.userId });
        eventType = 'snapshot.created';
        break;
      case 'snapshot.restore':
        requireTeacher();
        result = await restoreSnapshot({ courseId, command });
        eventType = 'snapshot.restored';
        break;
      case 'document.update':
        requireTeacher();
        result = await updateDocument({ courseId, roomName, command, actorUserId: access.userId });
        eventType = 'document.updated';
        break;
      default:
        return json({ error: 'Unsupported command' }, 400);
    }

    const event = await appendEvent({
      courseId,
      roomName,
      type: eventType,
      actorUserId: access.userId,
      payload: { command, result },
    });

    return json({ ok: true, result, event });
  } catch (error: any) {
    console.error('[class-workspace-command] failed', error);
    const message = String(error?.message || 'Internal server error');
    const status = Number(error?.status) || (/not found/i.test(message) ? 404 : /outside|forbidden/i.test(message) ? 403 : 500);
    return json({ error: message }, status);
  }
};
