BEGIN;

-- Global site-level preferences. Values remain JSON so future experiments can
-- share this table without requiring one column per preference.
CREATE TABLE IF NOT EXISTS "SiteSetting" (
  "key"       text        PRIMARY KEY,
  "value"     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "updatedBy" uuid        REFERENCES public."User" ("id") ON DELETE SET NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "SiteSetting" ("key", "value")
VALUES ('globalTheme', '{"theme":"default"}'::jsonb)
ON CONFLICT ("key") DO NOTHING;

COMMIT;
