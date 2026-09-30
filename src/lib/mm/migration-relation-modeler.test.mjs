import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../postgres-patches/migrations/20260930120000_mm_relation_modeler.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--.*$/gm, '');

test('relation modeler migration is one guarded, re-runnable transaction', () => {
  assert.match(statements, /^\s*BEGIN;/);
  assert.match(statements, /COMMIT;\s*$/);
  assert.equal([...statements.matchAll(/^\s*(BEGIN|COMMIT);/gm)].length, 2);
  // every ALTER TABLE … ADD CONSTRAINT is behind a pg_constraint existence check
  const adds = [...statements.matchAll(/ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(adds, [
    'Concept_kind_check',
    'ConceptRelation_typeId_fkey',
    'ConceptRelation_fromPostId_fkey',
    'ConceptRelation_settledBy_fkey',
    'ConceptRelation_source_target_typeId_key',
  ]);
  for (const name of adds) assert.match(statements, new RegExp(`conname = '${name}'`), name);
  for (const m of statements.matchAll(/CREATE (UNIQUE )?INDEX (\S+)/g)) assert.equal(m[2], 'IF', `index without IF NOT EXISTS: ${m[0]}`);
  for (const m of statements.matchAll(/CREATE TABLE (\S+)/g)) assert.equal(m[1], 'IF', `table without IF NOT EXISTS: ${m[0]}`);
  for (const m of statements.matchAll(/ADD COLUMN (\S+)/g)) assert.equal(m[1], 'IF', `column without IF NOT EXISTS: ${m[0]}`);
  for (const m of statements.matchAll(/DROP CONSTRAINT (\S+)/g)) assert.equal(m[1], 'IF', `drop without IF EXISTS: ${m[0]}`);
  for (const m of statements.matchAll(/CREATE (OR REPLACE )?FUNCTION/g)) assert.ok(m[1], 'function without OR REPLACE');
  const triggers = [...statements.matchAll(/CREATE TRIGGER "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(triggers, ['RelationType_touch_updated_at', 'ConceptRelationStance_touch_updated_at', 'ConceptRelation_type_sync']);
  for (const name of triggers) assert.match(statements, new RegExp(`DROP TRIGGER IF EXISTS "${name}"`), name);
  // seeds never overwrite and never duplicate
  assert.doesNotMatch(statements, /INSERT INTO "RelationType"[^;]*DO UPDATE/);
  assert.match(statements, /IF EXISTS \(SELECT 1 FROM "RelationType" t WHERE t\."spaceId" = p_space AND t\."slug" = b\.slug\) THEN\s+CONTINUE;/);
  // ownership only when the app role exists
  assert.match(statements, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'app'\) THEN/);
  assert.match(statements, /ARRAY\['RelationType', 'ConceptRelationStance'\]/);
  assert.match(statements, /ARRAY\['mm_seed_relation_types\(uuid\)', 'mm_concept_relation_type_sync\(\)', 'mm_stance_reveal_days\(jsonb\)'\]/);
});

test('relation modeler migration: enums, palette, area rule, stances', () => {
  assert.match(statements, /ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'concept'/);
  assert.match(statements, /CHECK \("kind" IN \('concept', 'relation-type'\)\)/);
  assert.match(statements, /CHECK \("render" IN \('line', 'area'\)\)/);
  assert.match(statements, /CHECK \("stroke" IN \('solid', 'dashed', 'dotted', 'double'\)\)/);
  assert.match(statements, /CHECK \("color" IN \('green', 'purple', 'blue', 'pink', 'yellow', 'red', 'ink'\)\)/);
  assert.match(statements, /CHECK \("render" <> 'area' OR "hierarchical"\)/);
  assert.match(statements, /CONSTRAINT "RelationType_spaceId_slug_key" UNIQUE \("spaceId", "slug"\)/);
  assert.match(statements, /CONSTRAINT "RelationType_conceptId_key" UNIQUE \("conceptId"\)/);
  assert.match(statements, /CHECK \("stance" IN \('agree', 'disagree'\)\)/);
  assert.match(statements, /PRIMARY KEY \("relationId", "userId"\)/);
  assert.match(statements, /"relationId"\s+uuid\s+NOT NULL REFERENCES "ConceptRelation"\("id"\) ON DELETE CASCADE/);
  assert.match(statements, /"userId"\s+uuid\s+NOT NULL REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  assert.match(statements, /"afterReveal" boolean\s+NOT NULL DEFAULT false/);
});

test('relation modeler migration: ConceptRelation type FK, provenance, uniqueness, legacy sync', () => {
  assert.match(statements, /FOREIGN KEY \("typeId"\) REFERENCES "RelationType"\("id"\) ON DELETE NO ACTION/);
  assert.match(statements, /FOREIGN KEY \("fromPostId"\) REFERENCES "ForumPost"\("id"\) ON DELETE SET NULL/);
  assert.match(statements, /FOREIGN KEY \("settledBy"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/);
  assert.match(statements, /ADD COLUMN IF NOT EXISTS "settledAt" timestamptz NULL/);
  assert.match(statements, /DROP CONSTRAINT IF EXISTS "ConceptRelation_type_check"/);
  assert.match(statements, /DROP CONSTRAINT IF EXISTS "ConceptRelation_source_target_type_key"/);
  assert.match(statements, /UNIQUE \("sourceId", "targetId", "typeId"\)/);
  // the legacy "type" column is kept (one release), never dropped here
  assert.doesNotMatch(statements, /DROP COLUMN/);
  // the trigger sees every UPDATE (it also guards "revealAt" and "settledAt")
  assert.match(statements, /BEFORE INSERT OR UPDATE ON "ConceptRelation"/);
  // order: seed → sync trigger → backfill → new uniqueness → NOT NULL
  const at = (re) => {
    const i = statements.search(re);
    assert.notEqual(i, -1, String(re));
    return i;
  };
  const order = [
    at(/PERFORM mm_seed_relation_types\(s\."id"\)/),
    at(/CREATE TRIGGER "ConceptRelation_type_sync"/),
    at(/UPDATE "ConceptRelation" r\s+SET "typeId" = t\."id"/),
    at(/ADD CONSTRAINT "ConceptRelation_source_target_typeId_key"/),
    at(/ALTER COLUMN "typeId" SET NOT NULL/),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('relation modeler migration: the five built-ins with their encodings', () => {
  const row = (slug) => {
    const m = statements.match(new RegExp(`\\('${slug}',[^)]*\\)`));
    assert.ok(m, slug);
    return m[0].replace(/\s+/g, ' ');
  };
  // (slug, label, labelNb, inverse, inverseNb, stroke, arrow, color, symmetric, transitive, position, definition)
  assert.match(row('derives'), /'derives from', '[^']+', 'gives rise to', '[^']+', 'solid', true, 'purple', false, true, 1, '[^']+\.'/);
  assert.match(row('combines'), /'combines with', '[^']+', NULL, NULL, 'solid', false, 'green', true, false, 2, '[^']+\.'/);
  assert.match(row('contrasts'), /'contrasts with', '[^']+', NULL, NULL, 'dashed', false, 'red', true, false, 3, '[^']+\.'/);
  assert.match(row('reformulates'), /'reformulates', '[^']+', 'is reformulated by', '[^']+', 'double', true, 'blue', false, false, 4, '[^']+\.'/);
  assert.match(row('exemplifies'), /'exemplifies', '[^']+', 'is exemplified by', '[^']+', 'dotted', true, 'yellow', false, false, 5, '[^']+\.'/);
  // seeded definition concepts: kind relation-type, namespaced slug, no thread, no author
  assert.match(statements, /VALUES \(p_space, 'rel:' \|\| b\.slug, b\.label, b\.label_nb, 'relation-type', NULL, NULL\)/);
  assert.match(statements, /VALUES \(v_concept, 'en', b\.definition, NULL, NULL\)/);
  assert.match(statements, /'line', b\.stroke, b\.arrow, b\.color, b\.is_symmetric, b\.is_transitive, false,\s+b\.pos, true, NULL/);
});

test('relation modeler migration: reveal date frozen per relation, no un-settle (DB level)', () => {
  assert.match(statements, /ADD COLUMN IF NOT EXISTS "revealAt" timestamptz NULL/);
  // days: the space setting when it is a number, clamped 1–90, else 14
  assert.match(statements, /CREATE OR REPLACE FUNCTION mm_stance_reveal_days\(p_settings jsonb\) RETURNS integer/);
  assert.match(statements, /jsonb_typeof\(p_settings -> 'stanceRevealDays'\) = 'number'/);
  assert.match(statements, /LEAST\(90, GREATEST\(1, round\(\(p_settings ->> 'stanceRevealDays'\)::numeric\)\)\)::int\s+ELSE 14 END/);
  // INSERT: always computed by the trigger (the old engine does not send it)
  assert.match(statements, /IF TG_OP = 'INSERT' THEN\s+NEW\."revealAt" := COALESCE\(NEW\."createdAt", now\(\)\) \+ make_interval\(days => COALESCE\(\s+\(SELECT mm_stance_reveal_days\(sp\."settings"\) FROM "Space" sp WHERE sp\."id" = NEW\."spaceId"\), 14\)\);/);
  // UPDATE: a set reveal date never changes; a settle time is never changed or cleared
  assert.match(statements, /IF OLD\."revealAt" IS NOT NULL AND NEW\."revealAt" IS DISTINCT FROM OLD\."revealAt" THEN\s+RAISE EXCEPTION/);
  assert.match(statements, /IF OLD\."settledAt" IS NOT NULL AND NEW\."settledAt" IS DISTINCT FROM OLD\."settledAt" THEN\s+RAISE EXCEPTION/);
  // order: helper → trigger → backfill (only NULLs) → NOT NULL
  const at = (re) => {
    const i = statements.search(re);
    assert.notEqual(i, -1, String(re));
    return i;
  };
  const order = [
    at(/CREATE OR REPLACE FUNCTION mm_stance_reveal_days/),
    at(/CREATE TRIGGER "ConceptRelation_type_sync"/),
    at(/SET "revealAt" = r\."createdAt" \+ make_interval\(days => mm_stance_reveal_days\(sp\."settings"\)\)\s+FROM "Space" sp\s+WHERE r\."revealAt" IS NULL/),
    at(/ALTER COLUMN "revealAt" SET NOT NULL/),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
