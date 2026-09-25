-- so studio workspace: folders in spaces, visibility levels, manual ordering, course XOR space.
BEGIN;

ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "spaceId" uuid NULL REFERENCES "Space"("id") ON DELETE CASCADE;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "visibility" text NULL;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "position" double precision NULL;
ALTER TABLE "LiveClassNote"       ADD COLUMN IF NOT EXISTS "visibility" text NULL;
ALTER TABLE "LiveClassNote"       ADD COLUMN IF NOT EXISTS "position" double precision NULL;

CREATE INDEX IF NOT EXISTS "LiveClassNoteFolder_spaceId_idx" ON "LiveClassNoteFolder" ("spaceId") WHERE "spaceId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNoteFolder_visibility_check') THEN
    ALTER TABLE "LiveClassNoteFolder" ADD CONSTRAINT "LiveClassNoteFolder_visibility_check"
      CHECK ("visibility" IN ('private','supervision','committee','public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNote_visibility_check') THEN
    ALTER TABLE "LiveClassNote" ADD CONSTRAINT "LiveClassNote_visibility_check"
      CHECK ("visibility" IN ('private','supervision','committee','public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNote_course_xor_space') THEN
    ALTER TABLE "LiveClassNote" ADD CONSTRAINT "LiveClassNote_course_xor_space"
      CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNoteFolder_course_xor_space') THEN
    ALTER TABLE "LiveClassNoteFolder" ADD CONSTRAINT "LiveClassNoteFolder_course_xor_space"
      CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
  END IF;
END
$$;

COMMIT;
