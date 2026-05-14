import { query } from '../db/pool';

let ensurePromise: Promise<void> | null = null;

const schemaSql = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceNodeKind') THEN
    CREATE TYPE "WorkspaceNodeKind" AS ENUM (
      'course',
      'module',
      'lesson',
      'assignment',
      'session',
      'folder',
      'resource',
      'snapshot',
      'note',
      'concept',
      'lily_block'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceVisibility') THEN
    CREATE TYPE "WorkspaceVisibility" AS ENUM ('teacher', 'class', 'private');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceSource') THEN
    CREATE TYPE "WorkspaceSource" AS ENUM ('musiki', 'room', 'obsidian', 'import', 'student');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassResourceAssetType') THEN
    CREATE TYPE "ClassResourceAssetType" AS ENUM (
      'link',
      'pdf',
      'pptx',
      'doc',
      'txt',
      'markdown',
      'image',
      'video',
      'audio',
      'lilypond',
      'other'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResourcePreviewStatus') THEN
    CREATE TYPE "ResourcePreviewStatus" AS ENUM ('pending', 'ready', 'failed', 'none');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResourceUploadStatus') THEN
    CREATE TYPE "ResourceUploadStatus" AS ENUM ('pending', 'uploading', 'ready', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ClassWorkspaceNode" (
  "id"              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "courseId"        text                  NOT NULL,
  "roomName"        text,
  "kind"            "WorkspaceNodeKind"   NOT NULL,
  "parentId"        uuid                  REFERENCES "ClassWorkspaceNode"("id") ON DELETE SET NULL,
  "name"            text                  NOT NULL DEFAULT '',
  "slug"            text,
  "sortKey"         text                  NOT NULL DEFAULT '',
  "ownerUserId"     text                  NOT NULL DEFAULT '',
  "createdByUserId" text                  NOT NULL DEFAULT '',
  "visibility"      "WorkspaceVisibility" NOT NULL DEFAULT 'class',
  "source"          "WorkspaceSource"     NOT NULL DEFAULT 'musiki',
  "metadata"        jsonb                 NOT NULL DEFAULT '{}'::jsonb,
  "revision"        bigint                NOT NULL DEFAULT 1,
  "createdAt"       timestamptz           NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz           NOT NULL DEFAULT now(),
  "deletedAt"       timestamptz
);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceNode_course_parent_idx"
  ON "ClassWorkspaceNode" ("courseId", "parentId", "sortKey");

CREATE INDEX IF NOT EXISTS "ClassWorkspaceNode_course_kind_idx"
  ON "ClassWorkspaceNode" ("courseId", "kind", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceNode_room_idx"
  ON "ClassWorkspaceNode" ("roomName", "kind", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceNode_deleted_idx"
  ON "ClassWorkspaceNode" ("courseId", "deletedAt")
  WHERE "deletedAt" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ClassResourceAsset" (
  "id"            uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  "nodeId"        uuid                     NOT NULL UNIQUE REFERENCES "ClassWorkspaceNode"("id") ON DELETE CASCADE,
  "mime"          text                     NOT NULL DEFAULT '',
  "resourceType"  "ClassResourceAssetType" NOT NULL DEFAULT 'other',
  "objectKey"     text,
  "externalUrl"   text,
  "sizeBytes"     bigint,
  "sha256"        text,
  "previewStatus" "ResourcePreviewStatus"  NOT NULL DEFAULT 'none',
  "uploadStatus"  "ResourceUploadStatus"   NOT NULL DEFAULT 'ready',
  "preview"       jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"     timestamptz              NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT "ClassResourceAsset_location_check"
    CHECK ("objectKey" IS NOT NULL OR "externalUrl" IS NOT NULL OR "uploadStatus" <> 'ready')
);

CREATE INDEX IF NOT EXISTS "ClassResourceAsset_type_idx"
  ON "ClassResourceAsset" ("resourceType", "uploadStatus", "previewStatus");

CREATE INDEX IF NOT EXISTS "ClassResourceAsset_object_key_idx"
  ON "ClassResourceAsset" ("objectKey")
  WHERE "objectKey" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ClassWorkspaceSnapshot" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "nodeId"          uuid        UNIQUE REFERENCES "ClassWorkspaceNode"("id") ON DELETE SET NULL,
  "courseId"        text        NOT NULL,
  "roomName"        text        NOT NULL,
  "sessionId"       uuid        REFERENCES "ResourceSession"("id") ON DELETE SET NULL,
  "name"            text        NOT NULL DEFAULT '',
  "layout"          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "podState"        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "createdByUserId" text        NOT NULL DEFAULT '',
  "revision"        bigint      NOT NULL DEFAULT 1,
  "createdAt"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceSnapshot_room_idx"
  ON "ClassWorkspaceSnapshot" ("roomName", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceSnapshot_course_idx"
  ON "ClassWorkspaceSnapshot" ("courseId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "ClassWorkspaceEvent" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "revision"    bigserial   UNIQUE,
  "courseId"    text        NOT NULL,
  "roomName"    text,
  "type"        text        NOT NULL,
  "actorUserId" text        NOT NULL DEFAULT '',
  "payload"     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceEvent_course_revision_idx"
  ON "ClassWorkspaceEvent" ("courseId", "revision" DESC);

CREATE INDEX IF NOT EXISTS "ClassWorkspaceEvent_room_revision_idx"
  ON "ClassWorkspaceEvent" ("roomName", "revision" DESC)
  WHERE "roomName" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "CourseTextDocument" (
  "id"              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  "nodeId"          uuid                UNIQUE REFERENCES "ClassWorkspaceNode"("id") ON DELETE SET NULL,
  "courseId"        text                NOT NULL,
  "kind"            "WorkspaceNodeKind" NOT NULL,
  "title"           text                NOT NULL DEFAULT '',
  "slug"            text,
  "bodyMd"          text                NOT NULL DEFAULT '',
  "astJson"         jsonb,
  "frontmatterJson" jsonb               NOT NULL DEFAULT '{}'::jsonb,
  "version"         integer             NOT NULL DEFAULT 1,
  "updatedByUserId" text                NOT NULL DEFAULT '',
  "createdAt"       timestamptz         NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "CourseTextDocument_course_kind_idx"
  ON "CourseTextDocument" ("courseId", "kind", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "CourseTextDocumentVersion" (
  "id"              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentId"      uuid              NOT NULL REFERENCES "CourseTextDocument"("id") ON DELETE CASCADE,
  "version"         integer           NOT NULL,
  "bodyMd"          text              NOT NULL DEFAULT '',
  "patch"           jsonb,
  "frontmatterJson" jsonb             NOT NULL DEFAULT '{}'::jsonb,
  "source"          "WorkspaceSource" NOT NULL DEFAULT 'musiki',
  "updatedByUserId" text              NOT NULL DEFAULT '',
  "createdAt"       timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT "CourseTextDocumentVersion_document_version_key"
    UNIQUE ("documentId", "version")
);

CREATE INDEX IF NOT EXISTS "CourseTextDocumentVersion_document_idx"
  ON "CourseTextDocumentVersion" ("documentId", "version" DESC);
`;

export async function ensureClassWorkspaceSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const result = await query(schemaSql, undefined, 0);
      if (result.error) {
        ensurePromise = null;
        throw result.error;
      }
    })();
  }
  return ensurePromise;
}
