-- Add folderId to LiveClassNote for personal notes folder organization
ALTER TABLE "LiveClassNote"
  ADD COLUMN IF NOT EXISTS "folderId" uuid;

CREATE INDEX IF NOT EXISTS "LiveClassNote_folderId_idx"
  ON "LiveClassNote" ("folderId")
  WHERE "folderId" IS NOT NULL;

-- Folder table for organizing personal notes
CREATE TABLE IF NOT EXISTS "LiveClassNoteFolder" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      varchar(200) NOT NULL,
  "parentId"  uuid REFERENCES "LiveClassNoteFolder"("id") ON DELETE CASCADE,
  "userId"    integer NOT NULL,
  "courseId"  varchar(200),
  "createdAt" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "LiveClassNoteFolder_userId_idx"
  ON "LiveClassNoteFolder" ("userId");
