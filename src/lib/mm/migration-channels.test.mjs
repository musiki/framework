import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../postgres-patches/migrations/20260929120000_mm_forum_channels.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--.*$/gm, '');

test('channels migration is one guarded, re-runnable transaction', () => {
  assert.match(statements, /^\s*BEGIN;/);
  assert.match(statements, /COMMIT;\s*$/);
  assert.match(statements, /ADD COLUMN IF NOT EXISTS "parentId" uuid NULL/);
  // every ADD CONSTRAINT is behind a pg_constraint existence check
  const adds = [...statements.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(adds, ['ForumBoard_parentId_fkey', 'ForumBoard_parent_space_only', 'ForumBoard_parent_not_self', 'ForumBoard_channel_slug_not_reserved']);
  for (const name of adds) assert.match(statements, new RegExp(`conname = '${name}'`), name);
  for (const m of statements.matchAll(/CREATE (UNIQUE )?INDEX (\S+)/g)) assert.equal(m[2], 'IF', `index without IF NOT EXISTS: ${m[0]}`);
  assert.match(statements, /CREATE OR REPLACE FUNCTION mm_forum_board_parent_check\(\)/);
  assert.match(statements, /DROP TRIGGER IF EXISTS "ForumBoard_parent_check"/);
  assert.match(statements, /DROP INDEX IF EXISTS "ForumBoard_space_slug_unique"/);
});

test('channels migration: FK cascade, space boards only, sibling uniqueness, one level', () => {
  assert.match(statements, /FOREIGN KEY \("parentId"\) REFERENCES "ForumBoard"\("id"\) ON DELETE CASCADE/);
  assert.match(statements, /CHECK \("parentId" IS NULL OR \("courseId" IS NULL AND "spaceId" IS NOT NULL\)\)/);
  assert.match(statements, /ON "ForumBoard" \("spaceId", "slug"\) WHERE "spaceId" IS NOT NULL AND "parentId" IS NULL/);
  assert.match(statements, /ON "ForumBoard" \("parentId", "slug"\) WHERE "parentId" IS NOT NULL/);
  assert.match(statements, /IF parent_parent IS NOT NULL THEN\s+RAISE EXCEPTION 'forum channels cannot have channels'/);
  assert.match(statements, /BEFORE INSERT OR UPDATE OF "parentId", "spaceId" ON "ForumBoard"/);
  // course boards: their unique index is never touched
  assert.doesNotMatch(statements, /ForumBoard_course_slug_unique/);
});
