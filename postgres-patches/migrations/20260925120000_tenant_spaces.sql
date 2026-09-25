-- Tenant layer: spaces that are not content-driven courses (so dissertation first).
-- 'course' is reserved for the future migration of courses into Postgres (spec §3.1).

BEGIN;

CREATE TABLE IF NOT EXISTS "Space" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"  text        NOT NULL,
  "kind"      text        NOT NULL CHECK ("kind" IN ('dissertation', 'course')),
  "slug"      text        NOT NULL,
  "title"     text        NOT NULL,
  "lang"      text        NOT NULL DEFAULT 'en',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenantId", "slug")
);

CREATE TABLE IF NOT EXISTS "SpaceMember" (
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "userId"    uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "role"      text        NOT NULL CHECK ("role" IN ('author', 'supervisor', 'coordinator', 'reviewer', 'guest')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("spaceId", "userId")
);
CREATE INDEX IF NOT EXISTS "SpaceMember_userId_idx" ON "SpaceMember" ("userId");

CREATE TABLE IF NOT EXISTS "SpaceInvite" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"    uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "email"      text        NOT NULL CHECK ("email" = lower("email")),
  "role"       text        NOT NULL CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest')),
  "token"      text        NOT NULL UNIQUE,
  "expiresAt"  timestamptz NOT NULL,
  "acceptedAt" timestamptz,
  "createdBy"  uuid        NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "SpaceInvite_email_idx" ON "SpaceInvite" ("email");

CREATE TABLE IF NOT EXISTS "SpaceAccessRule" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "kind"      text        NOT NULL CHECK ("kind" IN ('email', 'domain')),
  "value"     text        NOT NULL CHECK ("value" = lower("value")),
  "role"      text        NOT NULL CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest')),
  "createdBy" uuid        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", "kind", "value")
);
CREATE INDEX IF NOT EXISTS "SpaceAccessRule_value_idx" ON "SpaceAccessRule" ("kind", "value");

ALTER TABLE "LiveClassNote" ADD COLUMN IF NOT EXISTS "spaceId" uuid REFERENCES "Space"("id") ON DELETE SET NULL;
ALTER TABLE "LiveClassNote" ADD COLUMN IF NOT EXISTS "lang" text;
CREATE INDEX IF NOT EXISTS "LiveClassNote_spaceId_idx" ON "LiveClassNote" ("spaceId") WHERE "spaceId" IS NOT NULL;

COMMIT;
