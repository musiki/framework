-- mm follow-up to 20260929090000_mm_concepts_forum_spaces.sql (already applied on staging).
-- 1. Concept* user columns become nullable with ON DELETE SET NULL: the engine hard-deletes
--    users (admin users API) and deletes merged users (src/lib/user-email.ts mergeUsers,
--    which re-points these columns to the surviving user first, so credit is preserved).
-- 2. Concept* tables are owned by the engine role `app` (the first migration ran as a
--    superuser, leaving them owned by it and inaccessible to `app`).
-- Idempotent: safe to apply more than once.
BEGIN;

ALTER TABLE "Concept"         ALTER COLUMN "createdBy"      DROP NOT NULL;
ALTER TABLE "ConceptVersion"  ALTER COLUMN "editedBy"       DROP NOT NULL;
ALTER TABLE "ConceptVersion"  ALTER COLUMN "creditedUserId" DROP NOT NULL;
ALTER TABLE "ConceptRelation" ALTER COLUMN "createdBy"      DROP NOT NULL;

-- Default FK names from the first migration's inline REFERENCES.
ALTER TABLE "Concept" DROP CONSTRAINT IF EXISTS "Concept_createdBy_fkey";
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "ConceptVersion" DROP CONSTRAINT IF EXISTS "ConceptVersion_editedBy_fkey";
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_editedBy_fkey"
  FOREIGN KEY ("editedBy") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "ConceptVersion" DROP CONSTRAINT IF EXISTS "ConceptVersion_creditedUserId_fkey";
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_creditedUserId_fkey"
  FOREIGN KEY ("creditedUserId") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "ConceptRelation" DROP CONSTRAINT IF EXISTS "ConceptRelation_createdBy_fkey";
ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL;

-- Ownership → app (uuid PKs: no sequences). The Concept updatedAt trigger uses the
-- pre-existing public.touch_updated_at(), shared with the forum tables; nothing to change.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    FOREACH t IN ARRAY ARRAY['Concept', 'ConceptVersion', 'ConceptRelation'] LOOP
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t
          AND pg_get_userbyid(c.relowner) <> 'app'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I OWNER TO app', t);
      END IF;
    END LOOP;
  END IF;
END
$$;

COMMIT;
