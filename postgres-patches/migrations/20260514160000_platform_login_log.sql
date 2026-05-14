-- Platform login / access log
-- Records one entry per user per ~4 hours (deduplication is handled in application code)
-- to allow teachers to see who accessed the platform and when.

CREATE TABLE IF NOT EXISTS "PlatformLoginLog" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_login_log_user_created
  ON "PlatformLoginLog" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_platform_login_log_created
  ON "PlatformLoginLog" ("createdAt" DESC);
