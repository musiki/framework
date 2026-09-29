-- mm forum channels: one extra level under a space forum ("group" → "channels"),
-- like Discourse categories. Exactly one level: a channel cannot have channels.
-- Only space boards (mm) may be channels; musiki course boards ("spaceId" IS NULL)
-- are untouched (their unique index ForumBoard_course_slug_unique is not changed).
-- Slugs: top-level forums unique per space, channels unique per parent group.
-- Idempotent and guarded: safe to apply more than once.
BEGIN;

ALTER TABLE "ForumBoard" ADD COLUMN IF NOT EXISTS "parentId" uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumBoard_parentId_fkey') THEN
    ALTER TABLE "ForumBoard" ADD CONSTRAINT "ForumBoard_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "ForumBoard"("id") ON DELETE CASCADE;
  END IF;
  -- Channels are space boards only (never course boards), never their own parent,
  -- and never use the reserved slug "t" (/f/<group>/t/<thread> is a group thread).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumBoard_parent_space_only') THEN
    ALTER TABLE "ForumBoard" ADD CONSTRAINT "ForumBoard_parent_space_only"
      CHECK ("parentId" IS NULL OR ("courseId" IS NULL AND "spaceId" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumBoard_parent_not_self') THEN
    ALTER TABLE "ForumBoard" ADD CONSTRAINT "ForumBoard_parent_not_self"
      CHECK ("parentId" IS NULL OR "parentId" <> "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumBoard_channel_slug_not_reserved') THEN
    ALTER TABLE "ForumBoard" ADD CONSTRAINT "ForumBoard_channel_slug_not_reserved"
      CHECK ("parentId" IS NULL OR "slug" <> 't');
  END IF;
END
$$;

-- Sibling slug uniqueness replaces the space-wide (spaceId, slug) index.
DROP INDEX IF EXISTS "ForumBoard_space_slug_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "ForumBoard_space_top_slug_unique"
  ON "ForumBoard" ("spaceId", "slug") WHERE "spaceId" IS NOT NULL AND "parentId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ForumBoard_channel_slug_unique"
  ON "ForumBoard" ("parentId", "slug") WHERE "parentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ForumBoard_parentId_idx"
  ON "ForumBoard" ("parentId") WHERE "parentId" IS NOT NULL;

-- One level only (a CHECK cannot read other rows): the parent must be a
-- top-level board of the same space, and a board that has channels cannot
-- itself become a channel.
CREATE OR REPLACE FUNCTION mm_forum_board_parent_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_parent uuid;
  parent_space uuid;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT b."parentId", b."spaceId" INTO parent_parent, parent_space
    FROM "ForumBoard" b WHERE b."id" = NEW."parentId";
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing parent
  END IF;
  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'forum channels cannot have channels' USING ERRCODE = 'check_violation';
  END IF;
  IF parent_space IS DISTINCT FROM NEW."spaceId" THEN
    RAISE EXCEPTION 'a channel must be in its group''s space' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ForumBoard" c WHERE c."parentId" = NEW."id") THEN
    RAISE EXCEPTION 'a forum with channels cannot become a channel' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "ForumBoard_parent_check" ON "ForumBoard";
CREATE TRIGGER "ForumBoard_parent_check"
  BEFORE INSERT OR UPDATE OF "parentId", "spaceId" ON "ForumBoard"
  FOR EACH ROW EXECUTE FUNCTION mm_forum_board_parent_check();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app')
     AND EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'mm_forum_board_parent_check'
          AND pg_get_userbyid(p.proowner) <> 'app'
     ) THEN
    ALTER FUNCTION public.mm_forum_board_parent_check() OWNER TO app;
  END IF;
END
$$;

COMMIT;
