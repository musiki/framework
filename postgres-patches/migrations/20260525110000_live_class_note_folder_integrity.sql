-- Enforce the folder relationship used by the NOTAS sidebar tree.
-- Folder ownership/course scope is validated in the API before this FK is reached.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"LiveClassNote"'::regclass
      AND conname = 'LiveClassNote_folderId_fkey'
  ) THEN
    ALTER TABLE "LiveClassNote"
      ADD CONSTRAINT "LiveClassNote_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "LiveClassNoteFolder"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
