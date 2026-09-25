-- Usage:
-- psql -v ON_ERROR_STOP=1 -v author_email=you@example.org -v title='Dissertation title' -v slug=dissertation -f so-dissertation-space.sql
-- The author must already have a UserEmail row (sign in once first). If no
-- author row ends up in the space, the transaction is aborted and nothing is
-- written. Run with -v ON_ERROR_STOP=1 so psql stops at the exception.
BEGIN;
INSERT INTO "Space" ("tenantId", "kind", "slug", "title", "lang")
VALUES ('so', 'dissertation', :'slug', :'title', 'en')
ON CONFLICT ("tenantId", "slug") DO UPDATE SET "title" = EXCLUDED."title";

INSERT INTO "SpaceMember" ("spaceId", "userId", "role")
SELECT s."id", ue."userId", 'author'
FROM "Space" s
JOIN "UserEmail" ue ON ue."email" = lower(:'author_email')
WHERE s."tenantId" = 'so' AND s."slug" = :'slug'
ON CONFLICT ("spaceId", "userId") DO UPDATE SET "role" = 'author';

-- psql variables are not interpolated inside $$ bodies: pass the slug via a
-- transaction-local setting.
SELECT set_config('so.seed_slug', :'slug', true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
     WHERE s."tenantId" = 'so' AND s."slug" = current_setting('so.seed_slug') AND m."role" = 'author'
  ) THEN
    RAISE EXCEPTION 'so seed: no user found for the author email. Sign in once first, or write to sysop@musiki.org.ar';
  END IF;
END $$;

SELECT s."slug", m."role", ue."email"
FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
JOIN "UserEmail" ue ON ue."userId" = m."userId"
WHERE s."tenantId" = 'so';
COMMIT;
