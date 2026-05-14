export type WorkspaceNodeKind =
  | 'course'
  | 'module'
  | 'lesson'
  | 'assignment'
  | 'session'
  | 'folder'
  | 'resource'
  | 'snapshot'
  | 'note'
  | 'concept'
  | 'lily_block';

export type WorkspaceVisibility = 'teacher' | 'class' | 'private';

export type WorkspaceSource =
  | 'musiki'
  | 'room'
  | 'obsidian'
  | 'import'
  | 'student';

export type WorkspaceNode = {
  id: string;
  courseId: string;
  roomName?: string | null;
  kind: WorkspaceNodeKind;
  parentId: string | null;
  name: string;
  slug?: string | null;
  sortKey: string;
  ownerUserId: string;
  createdByUserId: string;
  visibility: WorkspaceVisibility;
  source: WorkspaceSource;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type ResourceAssetType =
  | 'link'
  | 'pdf'
  | 'pptx'
  | 'doc'
  | 'txt'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'lilypond'
  | 'other';

export type ResourcePreviewStatus = 'pending' | 'ready' | 'failed' | 'none';

export type ResourceUploadStatus =
  | 'pending'
  | 'uploading'
  | 'ready'
  | 'failed';

export type ResourceAsset = {
  id: string;
  nodeId: string;
  mime: string;
  resourceType: ResourceAssetType;
  objectKey?: string | null;
  externalUrl?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  previewStatus: ResourcePreviewStatus;
  uploadStatus: ResourceUploadStatus;
};

export type WorkspaceSnapshotPodState = {
  sa?: unknown;
  sv?: unknown;
  vs?: {
    kind?: 'pdf' | 'pptx' | 'image' | 'video' | null;
    resourceNodeId?: string | null;
    assetId?: string | null;
    url?: string | null;
    page?: number;
    zoom?: number;
  };
  conceptos?: unknown;
  notas?: {
    documentId?: string;
    version?: number;
    selection?: unknown;
  };
  lilycode?: {
    documentId?: string;
    version?: number;
    activeBlockId?: string;
    cursor?: unknown;
    scroll?: unknown;
  };
  recursos?: {
    selectedNodeIds?: string[];
    activeFolderId?: string | null;
  };
};

export type WorkspaceSnapshot = {
  id: string;
  courseId: string;
  roomName: string;
  sessionId?: string | null;
  name: string;
  layout: unknown;
  podState: WorkspaceSnapshotPodState;
  createdByUserId: string;
  createdAt: string;
};

export type SnapshotAwarePod = {
  getSnapshotPayload(): unknown;
  applySnapshotPayload(payload: unknown): Promise<void> | void;
};

export type UploadIntent = {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256?: string | null;
};

export type WorkspaceCommand =
  | { type: 'session.create'; name: string; claseId?: string | null }
  | { type: 'folder.create'; parentId: string | null; name: string }
  | { type: 'node.move'; nodeIds: string[]; targetParentId: string | null }
  | { type: 'node.rename'; nodeId: string; name: string }
  | { type: 'node.delete'; nodeIds: string[] }
  | { type: 'resource.link.create'; parentId: string | null; url: string; name?: string | null }
  | { type: 'resource.upload.prepare'; parentId: string | null; files: UploadIntent[] }
  | { type: 'resource.upload.complete'; uploadId: string; objectKey: string }
  | {
      type: 'snapshot.create';
      sessionId?: string | null;
      name?: string;
      layout?: unknown;
      podState?: WorkspaceSnapshotPodState;
    }
  | { type: 'snapshot.restore'; snapshotId: string }
  | {
      type: 'document.update';
      documentId?: string | null;
      nodeId?: string | null;
      parentId?: string | null;
      kind?: Extract<WorkspaceNodeKind, 'lesson' | 'assignment' | 'note' | 'concept' | 'lily_block'>;
      title?: string;
      slug?: string | null;
      baseVersion?: number | null;
      bodyMd: string;
      frontmatter?: Record<string, unknown>;
    };

export type WorkspaceLiveEvent =
  | { type: 'node.created'; nodeId: string; parentId: string | null; revision: number }
  | {
      type: 'node.moved';
      nodeIds: string[];
      targetParentId: string | null;
      sortKeys: Record<string, string>;
      revision: number;
    }
  | { type: 'node.renamed'; nodeId: string; name: string; revision: number }
  | { type: 'node.deleted'; nodeIds: string[]; revision: number }
  | { type: 'asset.ready'; nodeId: string; assetId: string; revision: number }
  | { type: 'snapshot.created'; snapshotId: string; revision: number }
  | { type: 'snapshot.restored'; snapshotId: string; revision: number }
  | { type: 'pod-state.updated'; podId: string; stateRef: string; revision: number };

export type PortableMirrorFrontmatter = {
  musiki_id: string;
  kind: WorkspaceNodeKind;
  course_id: string;
  parent_id?: string | null;
  slug?: string | null;
  title: string;
  sort_key?: string | null;
  visibility: WorkspaceVisibility;
  owner?: string | null;
  version: number;
  updated_at: string;
  sync_hash?: string | null;
};
