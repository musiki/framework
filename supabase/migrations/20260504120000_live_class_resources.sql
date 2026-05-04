-- Shared class resource list: files uploaded to R2 + links + auto-captured from chat/SA/ME.
-- One flat list per (claseId, roomName) session. Persisted via autosave from the Re pod.

CREATE TYPE "ResourceType" AS ENUM ('pdf', 'img', 'md', 'tex', 'ly', 'audio', 'link', 'other');
CREATE TYPE "ResourceSource" AS ENUM ('upload', 'chat', 'external-media', 'sa', 'sv', 'paste');

CREATE TABLE "LiveClassResource" (
  "id"          uuid              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "claseId"     text,
  "roomName"    text              NOT NULL,
  "url"         text              NOT NULL,
  "name"        text              NOT NULL DEFAULT '',
  "type"        "ResourceType"    NOT NULL DEFAULT 'other',
  "folder"      text              NOT NULL DEFAULT '',
  "source"      "ResourceSource"  NOT NULL DEFAULT 'upload',
  "createdBy"   text              NOT NULL DEFAULT '',
  "sortOrder"   integer           NOT NULL DEFAULT 0,
  "createdAt"   timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX "LiveClassResource_room_idx"
  ON "LiveClassResource" ("roomName", "claseId");
