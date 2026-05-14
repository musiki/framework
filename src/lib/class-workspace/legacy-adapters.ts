import type {
  ResourceAsset,
  ResourceAssetType,
  WorkspaceNode,
  WorkspaceSource,
} from './types';

export type LegacyResourceRow = {
  id: string;
  claseId?: string | null;
  roomName?: string | null;
  url: string;
  name: string;
  type?: string | null;
  folder?: string | null;
  source?: string | null;
  createdBy?: string | null;
  sortOrder?: number | null;
  createdAt?: string | Date | null;
  sessionId?: string | null;
};

export type LegacySessionRow = {
  id: string;
  roomName: string;
  name: string;
  courseId?: string | null;
  claseId?: string | null;
  createdAt?: string | Date | null;
};

const iso = (value: string | Date | null | undefined): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date(0).toISOString();
};

export function legacyResourceTypeToAssetType(type: string | null | undefined): ResourceAssetType {
  switch ((type ?? '').toLowerCase()) {
    case 'pdf':
      return 'pdf';
    case 'pptx':
      return 'pptx';
    case 'img':
      return 'image';
    case 'md':
      return 'markdown';
    case 'tex':
    case 'ly':
      return 'lilypond';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'link':
      return 'link';
    default:
      return 'other';
  }
}

export function legacyResourceSourceToWorkspaceSource(source: string | null | undefined): WorkspaceSource {
  return source === 'upload' || source === 'sa' || source === 'sv' || source === 'vs'
    ? 'room'
    : 'musiki';
}

export function legacySessionToWorkspaceNode(row: LegacySessionRow): WorkspaceNode {
  const createdAt = iso(row.createdAt);

  return {
    id: row.id,
    courseId: row.courseId || row.claseId || '',
    roomName: row.roomName,
    kind: 'session',
    parentId: null,
    name: row.name,
    slug: null,
    sortKey: createdAt,
    ownerUserId: '',
    createdByUserId: '',
    visibility: 'class',
    source: 'room',
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

export function legacyFolderToWorkspaceNode(input: {
  courseId: string;
  roomName?: string | null;
  folder: string;
  parentId: string | null;
  createdAt?: string | Date | null;
}): WorkspaceNode {
  const createdAt = iso(input.createdAt);
  const parentKey = input.parentId ?? 'root';
  const folderKey = input.folder.trim() || 'root';

  return {
    id: `legacy-folder:${input.courseId}:${parentKey}:${folderKey}`,
    courseId: input.courseId,
    roomName: input.roomName ?? null,
    kind: 'folder',
    parentId: input.parentId,
    name: folderKey,
    slug: folderKey,
    sortKey: folderKey,
    ownerUserId: '',
    createdByUserId: '',
    visibility: 'class',
    source: 'room',
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

export function legacyResourceToWorkspaceNode(
  row: LegacyResourceRow,
  input: {
    courseId: string;
    parentId: string | null;
  },
): WorkspaceNode {
  const createdAt = iso(row.createdAt);

  return {
    id: row.id,
    courseId: input.courseId,
    roomName: row.roomName ?? null,
    kind: 'resource',
    parentId: input.parentId,
    name: row.name || row.url,
    slug: null,
    sortKey: String(row.sortOrder ?? 0).padStart(8, '0'),
    ownerUserId: row.createdBy ?? '',
    createdByUserId: row.createdBy ?? '',
    visibility: 'class',
    source: legacyResourceSourceToWorkspaceSource(row.source),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

export function legacyResourceToAsset(row: LegacyResourceRow): ResourceAsset {
  const resourceType = legacyResourceTypeToAssetType(row.type);

  return {
    id: row.id,
    nodeId: row.id,
    mime: '',
    resourceType,
    objectKey: null,
    externalUrl: row.url,
    sizeBytes: null,
    sha256: null,
    previewStatus: 'none',
    uploadStatus: 'ready',
  };
}
