import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../postgres-patches/migrations/20261001090000_mm_concept_slug_alias.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--.*$/gm, '');

test('slug alias migration is one guarded, re-runnable transaction', () => {
  assert.match(statements, /^\s*BEGIN;/);
  assert.match(statements, /COMMIT;\s*$/);
  assert.match(statements, /CREATE TABLE IF NOT EXISTS "ConceptSlugAlias"/);
  for (const m of statements.matchAll(/CREATE (UNIQUE )?INDEX (\S+)/g)) assert.equal(m[2], 'IF', m[0]);
  const adds = [...statements.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
  for (const name of adds) assert.match(statements, new RegExp(`conname = '${name}'`), name);
  assert.doesNotMatch(statements, /DROP TABLE|DELETE FROM|TRUNCATE/);
});

test('slug alias migration: space + concept cascade, one owner per (space, slug), app owns it', () => {
  assert.match(statements, /"spaceId"\s+uuid\s+NOT NULL REFERENCES "Space"\("id"\) ON DELETE CASCADE/);
  assert.match(statements, /"conceptId"\s+uuid\s+NOT NULL REFERENCES "Concept"\("id"\) ON DELETE CASCADE/);
  assert.match(statements, /PRIMARY KEY \("spaceId", "slug"\)/);
  assert.match(statements, /"createdAt"\s+timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(statements, /rolname = 'app'[\s\S]*relname = 'ConceptSlugAlias'[\s\S]*OWNER TO app/);
});
