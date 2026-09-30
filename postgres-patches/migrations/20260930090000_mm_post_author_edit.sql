-- mm: authors edit / delete their own forum posts.
--   "editedAt"        set by an author edit (moderation hide/unhide only bumps
--                     "updatedAt", so the "edited" marker needs its own stamp).
--   "deletedByAuthor" true when the author (not a moderator) soft-deleted the
--                     post, so the tombstone can say who removed it.
-- Additive, nullable/defaulted: musiki course routes (SELECT p.*) are unaffected.
-- Idempotent.
BEGIN;
ALTER TABLE "ForumPost" ADD COLUMN IF NOT EXISTS "editedAt" timestamptz NULL;
ALTER TABLE "ForumPost" ADD COLUMN IF NOT EXISTS "deletedByAuthor" boolean NOT NULL DEFAULT false;
COMMIT;
