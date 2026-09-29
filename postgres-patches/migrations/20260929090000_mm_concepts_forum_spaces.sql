-- mm (MishMash Concept Machine): commons spaces, concepts with per-language credited
-- definition versions, concept relations, and musiki forum generalization (course XOR space).
-- Additive and idempotent: safe to apply more than once. Spec §3–§4 of
-- docs/superpowers/specs/2026-09-28-mm-concept-machine-design.md.
-- Follow-up: 20260929090100_mm_followup.sql (Concept* user FKs → nullable ON DELETE SET NULL,
-- table ownership → app). Apply both.
BEGIN;

-- ── Space: settings + commons kind ─────────────────────────────────────────────
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- CHECK constraints are replaced wholesale (drop by name, re-add the union).
-- Per-kind role validity is enforced in code (src/lib/tenant/space-roles.ts).
ALTER TABLE "Space" DROP CONSTRAINT IF EXISTS "Space_kind_check";
ALTER TABLE "Space" ADD CONSTRAINT "Space_kind_check"
  CHECK ("kind" IN ('dissertation', 'course', 'commons'));

ALTER TABLE "SpaceMember" DROP CONSTRAINT IF EXISTS "SpaceMember_role_check";
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_role_check"
  CHECK ("role" IN ('author', 'supervisor', 'coordinator', 'reviewer', 'guest', 'admin', 'curator', 'member'));

-- Invites and access rules never grant 'author' or 'admin'.
ALTER TABLE "SpaceInvite" DROP CONSTRAINT IF EXISTS "SpaceInvite_role_check";
ALTER TABLE "SpaceInvite" ADD CONSTRAINT "SpaceInvite_role_check"
  CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest', 'curator', 'member'));

ALTER TABLE "SpaceAccessRule" DROP CONSTRAINT IF EXISTS "SpaceAccessRule_role_check";
ALTER TABLE "SpaceAccessRule" ADD CONSTRAINT "SpaceAccessRule_role_check"
  CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest', 'curator', 'member'));

-- ── Forum generalization: course XOR space ─────────────────────────────────────
ALTER TABLE "ForumBoard" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "ForumBoard" ADD COLUMN IF NOT EXISTS "spaceId" uuid NULL REFERENCES "Space"("id") ON DELETE CASCADE;
-- settings.zoteroCollection, settings.seshatLibraryId, settings.ownerEmail
ALTER TABLE "ForumBoard" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "ForumThread" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "ForumThread" ALTER COLUMN "lessonSlug" DROP NOT NULL;
ALTER TABLE "ForumThread" ADD COLUMN IF NOT EXISTS "spaceId" uuid NULL REFERENCES "Space"("id") ON DELETE CASCADE;
ALTER TABLE "ForumThread" ADD COLUMN IF NOT EXISTS "boardId" uuid NULL REFERENCES "ForumBoard"("id") ON DELETE SET NULL;

ALTER TABLE "ForumPost" ADD COLUMN IF NOT EXISTS "move" text NULL;

CREATE INDEX IF NOT EXISTS "ForumBoard_spaceId_idx" ON "ForumBoard" ("spaceId") WHERE "spaceId" IS NOT NULL;
-- ForumBoard_course_slug_unique does not cover space boards (courseId IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "ForumBoard_space_slug_unique" ON "ForumBoard" ("spaceId", "slug") WHERE "spaceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ForumThread_spaceId_idx" ON "ForumThread" ("spaceId", "updatedAt" DESC) WHERE "spaceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ForumThread_boardId_idx" ON "ForumThread" ("boardId") WHERE "boardId" IS NOT NULL;

DO $$
BEGIN
  -- Existing rows all have courseId (the column was NOT NULL) and no spaceId, so these hold.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumBoard_course_xor_space') THEN
    ALTER TABLE "ForumBoard" ADD CONSTRAINT "ForumBoard_course_xor_space"
      CHECK (("courseId" IS NULL) <> ("spaceId" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumThread_course_xor_space') THEN
    ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_course_xor_space"
      CHECK (("courseId" IS NULL) <> ("spaceId" IS NULL));
  END IF;
  -- Course threads keep requiring a lesson slug; space threads do not.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumThread_course_lesson_check') THEN
    ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_course_lesson_check"
      CHECK ("courseId" IS NULL OR "lessonSlug" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumPost_move_check') THEN
    ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_move_check"
      CHECK ("move" IN ('comment', 'proposes', 'contrasts', 'combines', 'exemplifies', 'problematises', 'synthesises'));
  END IF;
END
$$;

-- ── Concepts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Concept" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "forumId"   uuid        NULL REFERENCES "ForumBoard"("id") ON DELETE SET NULL,
  "slug"      text        NOT NULL,
  "label"     text        NOT NULL,
  "labelNb"   text        NULL,
  "status"    text        NOT NULL DEFAULT 'neologism',
  "threadId"  uuid        NULL REFERENCES "ForumThread"("id") ON DELETE SET NULL,
  "createdBy" uuid        NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Concept_status_check" CHECK ("status" IN ('neologism', 'discussion', 'assimilated')),
  CONSTRAINT "Concept_spaceId_slug_key" UNIQUE ("spaceId", "slug")
);
CREATE INDEX IF NOT EXISTS "Concept_forumId_idx" ON "Concept" ("forumId") WHERE "forumId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Concept_space_status_idx" ON "Concept" ("spaceId", "status");

CREATE TABLE IF NOT EXISTS "ConceptVersion" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "conceptId"      uuid        NOT NULL REFERENCES "Concept"("id") ON DELETE CASCADE,
  "lang"           text        NOT NULL DEFAULT 'en',
  "definition"     text        NOT NULL,
  "sources"        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "editedBy"       uuid        NOT NULL REFERENCES "User"("id"),
  "creditedUserId" uuid        NOT NULL REFERENCES "User"("id"),
  "fromPostId"     uuid        NULL REFERENCES "ForumPost"("id") ON DELETE SET NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ConceptVersion_lang_check" CHECK ("lang" IN ('en', 'nb', 'nn'))
);
-- Current definition per language = latest by createdAt.
CREATE INDEX IF NOT EXISTS "ConceptVersion_concept_lang_created_idx" ON "ConceptVersion" ("conceptId", "lang", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ConceptVersion_creditedUserId_idx" ON "ConceptVersion" ("creditedUserId");

CREATE TABLE IF NOT EXISTS "ConceptRelation" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "sourceId"  uuid        NOT NULL REFERENCES "Concept"("id") ON DELETE CASCADE,
  "targetId"  uuid        NOT NULL REFERENCES "Concept"("id") ON DELETE CASCADE,
  "type"      text        NOT NULL,
  "createdBy" uuid        NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ConceptRelation_type_check" CHECK ("type" IN ('derives', 'combines', 'contrasts', 'reformulates', 'exemplifies')),
  CONSTRAINT "ConceptRelation_no_self" CHECK ("sourceId" <> "targetId"),
  CONSTRAINT "ConceptRelation_source_target_type_key" UNIQUE ("sourceId", "targetId", "type")
);
CREATE INDEX IF NOT EXISTS "ConceptRelation_spaceId_idx" ON "ConceptRelation" ("spaceId");
CREATE INDEX IF NOT EXISTS "ConceptRelation_targetId_idx" ON "ConceptRelation" ("targetId");

DROP TRIGGER IF EXISTS "Concept_touch_updated_at" ON "Concept";
CREATE TRIGGER "Concept_touch_updated_at"
  BEFORE UPDATE ON "Concept" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── ForumPost → ConceptVersion (needs ConceptVersion) ──────────────────────────
ALTER TABLE "ForumPost" ADD COLUMN IF NOT EXISTS "adoptedAsVersionId" uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ForumPost_adoptedAsVersionId_fkey') THEN
    ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_adoptedAsVersionId_fkey"
      FOREIGN KEY ("adoptedAsVersionId") REFERENCES "ConceptVersion"("id") ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ForumPost_adoptedAsVersionId_idx" ON "ForumPost" ("adoptedAsVersionId") WHERE "adoptedAsVersionId" IS NOT NULL;

COMMIT;
