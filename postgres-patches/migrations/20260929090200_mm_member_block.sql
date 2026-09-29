-- Removed commons members stay removed: open-join skips blocked (space, user) pairs.
-- Idempotent.
CREATE TABLE IF NOT EXISTS "SpaceMemberBlock" (
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "userId"    uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "blockedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("spaceId", "userId")
);
CREATE INDEX IF NOT EXISTS "SpaceMemberBlock_userId_idx" ON "SpaceMemberBlock" ("userId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app')
     AND EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'SpaceMemberBlock'
          AND pg_get_userbyid(c.relowner) <> 'app'
     ) THEN
    ALTER TABLE public."SpaceMemberBlock" OWNER TO app;
  END IF;
END $$;
