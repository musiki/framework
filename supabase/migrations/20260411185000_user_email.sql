-- UserEmail: multi-email identity table
-- One User can have many emails; each email must be unique across users.
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "UserEmail" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "UserEmail_email_unique" UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS "UserEmail_userId_idx" ON "UserEmail"("userId");
CREATE INDEX IF NOT EXISTS "UserEmail_email_idx"  ON "UserEmail"(email);

-- Seed from existing User.email (one primary email per user)
INSERT INTO "UserEmail" (id, "userId", email, "isPrimary", "createdAt")
SELECT
  gen_random_uuid(),
  u.id,
  lower(trim(u.email)),
  true,
  COALESCE(u."createdAt", now())
FROM "User" u
WHERE u.email IS NOT NULL
  AND trim(u.email) <> ''
ON CONFLICT (email) DO NOTHING;
