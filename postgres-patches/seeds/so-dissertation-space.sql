-- Usage:
-- psql -v author_email=you@example.org -v title='Dissertation title' -v slug=dissertation -f so-dissertation-space.sql
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

SELECT s."slug", m."role", ue."email"
FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
JOIN "UserEmail" ue ON ue."userId" = m."userId"
WHERE s."tenantId" = 'so';
COMMIT;
