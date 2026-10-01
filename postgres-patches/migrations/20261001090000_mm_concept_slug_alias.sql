-- mm: concept permalinks at the root (mm.zztt.org/<slug>) and slug renames.
--   "ConceptSlugAlias": a slug a concept had before a curator renamed it. The
--   concept page 301-redirects an alias to the concept's current slug forever.
--   Aliases point at the concept id, so earlier aliases keep working after
--   further renames; deleting the concept (or its space) removes them.
--   The engine keeps aliases and live slugs disjoint (renameConceptSlug and
--   createConcept check both under the per-space slug advisory lock); the
--   primary key keeps one owner per (space, slug).
-- Additive: musiki course routes never read it. Idempotent and guarded.
BEGIN;

CREATE TABLE IF NOT EXISTS "ConceptSlugAlias" (
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "slug"      text        NOT NULL,
  "conceptId" uuid        NOT NULL REFERENCES "Concept"("id") ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("spaceId", "slug")
);
CREATE INDEX IF NOT EXISTS "ConceptSlugAlias_conceptId_idx" ON "ConceptSlugAlias" ("conceptId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConceptSlugAlias_slug_check') THEN
    ALTER TABLE "ConceptSlugAlias" ADD CONSTRAINT "ConceptSlugAlias_slug_check"
      CHECK (char_length("slug") BETWEEN 1 AND 200);
  END IF;
END
$$;

-- The app role owns the mm tables (it runs the engine's statements).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app')
     AND EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'ConceptSlugAlias'
          AND pg_get_userbyid(c.relowner) <> 'app'
     ) THEN
    ALTER TABLE public."ConceptSlugAlias" OWNER TO app;
  END IF;
END
$$;

COMMIT;
