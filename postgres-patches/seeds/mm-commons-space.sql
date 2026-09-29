-- MishMash Concept Machine: the mm commons space and its first admin.
-- Usage (after the 20260929090* mm migrations):
-- psql -v ON_ERROR_STOP=1 -v admin_email=you@example.org -f mm-commons-space.sql
-- Idempotent: re-running keeps the space as is (its settings, e.g. openJoin
-- toggled later in the admin UI, are not reset) and (re)makes the user admin.
-- The admin must already have a UserEmail row (sign in once first). If no
-- admin row ends up in the space, the transaction is aborted and nothing is
-- written. Run with -v ON_ERROR_STOP=1 so psql stops at the exception.
BEGIN;
INSERT INTO "Space" ("tenantId", "kind", "slug", "title", "lang", "settings")
VALUES ('mm', 'commons', 'mishmash', 'MishMash Concept Machine', 'en', '{"openJoin":false}'::jsonb)
ON CONFLICT ("tenantId", "slug") DO NOTHING;

INSERT INTO "SpaceMember" ("spaceId", "userId", "role")
SELECT s."id", ue."userId", 'admin'
FROM "Space" s
JOIN "UserEmail" ue ON ue."email" = lower(:'admin_email')
WHERE s."tenantId" = 'mm' AND s."slug" = 'mishmash' AND s."kind" = 'commons'
ON CONFLICT ("spaceId", "userId") DO UPDATE SET "role" = 'admin';

-- psql variables are not interpolated inside $$ bodies: pass the email via a
-- transaction-local setting.
SELECT set_config('mm.seed_admin_email', lower(:'admin_email'), true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Space" s WHERE s."tenantId" = 'mm' AND s."slug" = 'mishmash' AND s."kind" = 'commons'
  ) THEN
    RAISE EXCEPTION 'mm seed: space mm/mishmash exists but is not a commons space';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
      JOIN "UserEmail" ue ON ue."userId" = m."userId"
     WHERE s."tenantId" = 'mm' AND s."slug" = 'mishmash' AND m."role" = 'admin'
       AND ue."email" = current_setting('mm.seed_admin_email')
  ) THEN
    RAISE EXCEPTION 'mm seed: no user found for the admin email. Sign in once first, or write to sysop@musiki.org.ar';
  END IF;
END $$;

SELECT s."slug", s."kind", s."settings", m."role", ue."email"
FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
JOIN "UserEmail" ue ON ue."userId" = m."userId"
WHERE s."tenantId" = 'mm';
COMMIT;
