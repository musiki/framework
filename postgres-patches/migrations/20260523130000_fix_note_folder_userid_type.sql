-- Fix LiveClassNoteFolder.userId type: was integer, must be uuid to match User.id
-- The original migration (20260523120000) incorrectly used integer; no rows exist yet so this is safe.

ALTER TABLE "LiveClassNoteFolder"
  ALTER COLUMN "userId" TYPE uuid USING "userId"::text::uuid;
