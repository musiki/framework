-- mm Relation Modeler: relation types become first-class, space-wide vocabulary.
-- Spec: docs/superpowers/specs/2026-09-30-mm-relation-modeler-design.md ("Data model").
--   * "Concept"."kind": 'concept' | 'relation-type'. A relation type owns one Concept
--     row of kind 'relation-type' (definition versions, optional thread). Its slug is
--     'rel:<type slug>': concept slugs come from slugify ([a-z0-9-]), so the colon
--     keeps the two namespaces apart under the existing unique ("spaceId", slug).
--   * "RelationType": label/inverse, visual encoding (palette slot, never a free
--     colour), logical properties, built-in/archived flags.
--   * "ConceptRelation": "typeId" (FK), provenance "fromPostId", settle state, and
--     "revealAt": the date its stances are revealed, FROZEN when the relation is
--     created (createdAt + the space's stanceRevealDays at that moment). Changing
--     the space setting later never moves it; settling can only bring the reveal
--     forward. The trigger below sets it on INSERT and refuses any later change,
--     and refuses to change or clear a settle time (no un-settle).
--     The legacy text column "type" stays for one release and always holds the type's
--     slug: a trigger keeps "type" and "typeId" in step whichever one a writer sets,
--     so the engine version deployed before this migration keeps working.
--   * "ConceptRelationStance": one agree/disagree per (relation, user).
--   * mm_seed_relation_types(space): the five built-ins, used here for every existing
--     space and callable by the engine for spaces created later.
-- Idempotent and guarded: safe to apply more than once. Seeds never overwrite rows
-- that already exist (curators may have edited the built-ins).
BEGIN;

-- ── Concept.kind ───────────────────────────────────────────────────────────────
ALTER TABLE "Concept" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'concept';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Concept_kind_check') THEN
    ALTER TABLE "Concept" ADD CONSTRAINT "Concept_kind_check"
      CHECK ("kind" IN ('concept', 'relation-type'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Concept_space_kind_idx" ON "Concept" ("spaceId", "kind");

-- ── RelationType ───────────────────────────────────────────────────────────────
-- "conceptId" is ON DELETE NO ACTION (not CASCADE, not RESTRICT): the definition
-- concept cannot be deleted from under its type, while deleting a whole Space
-- (which cascades to both in one statement) still works.
CREATE TABLE IF NOT EXISTS "RelationType" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"        uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "conceptId"      uuid        NOT NULL REFERENCES "Concept"("id") ON DELETE NO ACTION,
  "slug"           text        NOT NULL,
  "label"          text        NOT NULL,
  "labelNb"        text        NULL,
  "inverseLabel"   text        NULL,
  "inverseLabelNb" text        NULL,
  "render"         text        NOT NULL DEFAULT 'line',
  "stroke"         text        NOT NULL DEFAULT 'solid',
  "arrow"          boolean     NOT NULL DEFAULT true,
  "color"          text        NOT NULL DEFAULT 'ink',
  "symmetric"      boolean     NOT NULL DEFAULT false,
  "transitive"     boolean     NOT NULL DEFAULT false,
  "hierarchical"   boolean     NOT NULL DEFAULT false,
  "skos"           text        NULL,
  "wikidata"       text        NULL,
  "position"       integer     NOT NULL DEFAULT 0,
  "isBuiltin"      boolean     NOT NULL DEFAULT false,
  "isArchived"     boolean     NOT NULL DEFAULT false,
  "createdBy"      uuid        NULL REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RelationType_spaceId_slug_key" UNIQUE ("spaceId", "slug"),
  CONSTRAINT "RelationType_conceptId_key" UNIQUE ("conceptId"),
  CONSTRAINT "RelationType_render_check" CHECK ("render" IN ('line', 'area')),
  CONSTRAINT "RelationType_stroke_check" CHECK ("stroke" IN ('solid', 'dashed', 'dotted', 'double')),
  CONSTRAINT "RelationType_color_check"
    CHECK ("color" IN ('green', 'purple', 'blue', 'pink', 'yellow', 'red', 'ink')),
  -- An area is a container and its members: only hierarchical types render as areas.
  CONSTRAINT "RelationType_area_hierarchical_check" CHECK ("render" <> 'area' OR "hierarchical"),
  -- Hierarchical implies directed.
  CONSTRAINT "RelationType_hierarchical_directed_check" CHECK (NOT ("symmetric" AND "hierarchical"))
);
CREATE INDEX IF NOT EXISTS "RelationType_space_position_idx" ON "RelationType" ("spaceId", "position");

DROP TRIGGER IF EXISTS "RelationType_touch_updated_at" ON "RelationType";
CREATE TRIGGER "RelationType_touch_updated_at"
  BEFORE UPDATE ON "RelationType" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── ConceptRelation: type FK, provenance, settle state ─────────────────────────
-- "typeId" is ON DELETE NO ACTION: a type in use is archived, never deleted
-- (deleting a whole Space still cascades through both tables in one statement).
ALTER TABLE "ConceptRelation" ADD COLUMN IF NOT EXISTS "typeId" uuid NULL;
ALTER TABLE "ConceptRelation" ADD COLUMN IF NOT EXISTS "fromPostId" uuid NULL;
ALTER TABLE "ConceptRelation" ADD COLUMN IF NOT EXISTS "settledAt" timestamptz NULL;
ALTER TABLE "ConceptRelation" ADD COLUMN IF NOT EXISTS "settledBy" uuid NULL;
-- Set by the trigger on INSERT, backfilled below, then NOT NULL.
ALTER TABLE "ConceptRelation" ADD COLUMN IF NOT EXISTS "revealAt" timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConceptRelation_typeId_fkey') THEN
    ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_typeId_fkey"
      FOREIGN KEY ("typeId") REFERENCES "RelationType"("id") ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConceptRelation_fromPostId_fkey') THEN
    ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_fromPostId_fkey"
      FOREIGN KEY ("fromPostId") REFERENCES "ForumPost"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConceptRelation_settledBy_fkey') THEN
    ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_settledBy_fkey"
      FOREIGN KEY ("settledBy") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ConceptRelation_typeId_idx" ON "ConceptRelation" ("typeId");
CREATE INDEX IF NOT EXISTS "ConceptRelation_fromPostId_idx"
  ON "ConceptRelation" ("fromPostId") WHERE "fromPostId" IS NOT NULL;

-- "type" now holds any relation type slug of the space, not only the five built-ins.
ALTER TABLE "ConceptRelation" DROP CONSTRAINT IF EXISTS "ConceptRelation_type_check";

-- Days between a relation's creation and the reveal of its stances, from the
-- space's settings: "stanceRevealDays" when it is a JSON number (rounded, clamped
-- to 1–90), else 14. Only read when a relation is created.
CREATE OR REPLACE FUNCTION mm_stance_reveal_days(p_settings jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_settings -> 'stanceRevealDays') = 'number'
              THEN LEAST(90, GREATEST(1, round((p_settings ->> 'stanceRevealDays')::numeric)))::int
              ELSE 14 END
$$;

-- ── ConceptRelationStance ──────────────────────────────────────────────────────
-- Blind-then-revealed is enforced by the queries that read this table (names are
-- selected only once now() >= reveal time = the earlier of "revealAt" and "settledAt"); a withdrawn stance is a deleted row.
CREATE TABLE IF NOT EXISTS "ConceptRelationStance" (
  "relationId"  uuid        NOT NULL REFERENCES "ConceptRelation"("id") ON DELETE CASCADE,
  "userId"      uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "stance"      text        NOT NULL,
  "afterReveal" boolean     NOT NULL DEFAULT false,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("relationId", "userId"),
  CONSTRAINT "ConceptRelationStance_stance_check" CHECK ("stance" IN ('agree', 'disagree'))
);
CREATE INDEX IF NOT EXISTS "ConceptRelationStance_userId_idx" ON "ConceptRelationStance" ("userId");

DROP TRIGGER IF EXISTS "ConceptRelationStance_touch_updated_at" ON "ConceptRelationStance";
CREATE TRIGGER "ConceptRelationStance_touch_updated_at"
  BEFORE UPDATE ON "ConceptRelationStance" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Built-in relation types ────────────────────────────────────────────────────
-- Creates, for one space, whichever of the five built-ins it does not have yet:
-- the definition Concept (kind 'relation-type', no thread, no author), its v1
-- English definition, and the RelationType row. Existing rows are left untouched.
-- Returns the number of types created. Bokmål labels are drafts.
CREATE OR REPLACE FUNCTION mm_seed_relation_types(p_space uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  b record;
  v_concept uuid;
  v_rows integer;
  v_created integer := 0;
BEGIN
  FOR b IN
    SELECT * FROM (VALUES
      ('derives', 'derives from', 'avledes fra', 'gives rise to', 'gir opphav til',
       'solid', true, 'purple', false, true, 1,
       'The source concept derives from the target concept: it was developed out of it and presupposes it.'),
      ('combines', 'combines with', 'kombineres med', NULL, NULL,
       'solid', false, 'green', true, false, 2,
       'The two concepts combine: they are used together, and each extends what the other can describe.'),
      ('contrasts', 'contrasts with', 'står i kontrast til', NULL, NULL,
       'dashed', false, 'red', true, false, 3,
       'The two concepts contrast: they address the same matter in ways that differ or oppose each other.'),
      ('reformulates', 'reformulates', 'reformulerer', 'is reformulated by', 'reformuleres av',
       'double', true, 'blue', false, false, 4,
       'The source concept reformulates the target concept: it restates the same idea in other terms or for another context.'),
      ('exemplifies', 'exemplifies', 'eksemplifiserer', 'is exemplified by', 'eksemplifiseres av',
       'dotted', true, 'yellow', false, false, 5,
       'The source concept exemplifies the target concept: it is a particular case or instance of it.')
    ) AS v(slug, label, label_nb, inverse, inverse_nb, stroke, arrow, color, is_symmetric, is_transitive, pos, definition)
  LOOP
    IF EXISTS (SELECT 1 FROM "RelationType" t WHERE t."spaceId" = p_space AND t."slug" = b.slug) THEN
      CONTINUE;
    END IF;

    INSERT INTO "Concept" ("spaceId", "slug", "label", "labelNb", "kind", "threadId", "createdBy")
    VALUES (p_space, 'rel:' || b.slug, b.label, b.label_nb, 'relation-type', NULL, NULL)
    ON CONFLICT ("spaceId", "slug") DO UPDATE SET "kind" = 'relation-type'
    RETURNING "id" INTO v_concept;

    IF NOT EXISTS (SELECT 1 FROM "ConceptVersion" cv WHERE cv."conceptId" = v_concept AND cv."lang" = 'en') THEN
      INSERT INTO "ConceptVersion" ("conceptId", "lang", "definition", "editedBy", "creditedUserId")
      VALUES (v_concept, 'en', b.definition, NULL, NULL);
    END IF;

    INSERT INTO "RelationType" (
      "spaceId", "conceptId", "slug", "label", "labelNb", "inverseLabel", "inverseLabelNb",
      "render", "stroke", "arrow", "color", "symmetric", "transitive", "hierarchical",
      "position", "isBuiltin", "createdBy"
    )
    VALUES (
      p_space, v_concept, b.slug, b.label, b.label_nb, b.inverse, b.inverse_nb,
      'line', b.stroke, b.arrow, b.color, b.is_symmetric, b.is_transitive, false,
      b.pos, true, NULL
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_created := v_created + v_rows;
  END LOOP;
  RETURN v_created;
END
$$;

-- Every commons space, plus any space that already holds relations (so the backfill
-- below always finds its type).
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN
    SELECT sp."id" FROM "Space" sp
     WHERE sp."kind" = 'commons'
        OR EXISTS (SELECT 1 FROM "ConceptRelation" r WHERE r."spaceId" = sp."id")
  LOOP
    PERFORM mm_seed_relation_types(s."id");
  END LOOP;
END
$$;

-- ── "type" ⇄ "typeId", frozen "revealAt", no un-settle ─────────────────────────
-- INSERT: "revealAt" is always computed here (whatever the writer sent), so the
-- engine version deployed before this migration, which does not know the column,
-- keeps working. UPDATE: "revealAt" cannot change once set, and a settle time
-- cannot be changed or cleared.
-- Whichever column the writer sets, the other follows; "typeId" wins when both are
-- given. The type must belong to the relation's space. Runs BEFORE the NOT NULL
-- checks, so an INSERT may give only one of the two.
CREATE OR REPLACE FUNCTION mm_concept_relation_type_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t_slug text;
  t_space uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."revealAt" := COALESCE(NEW."createdAt", now()) + make_interval(days => COALESCE(
      (SELECT mm_stance_reveal_days(sp."settings") FROM "Space" sp WHERE sp."id" = NEW."spaceId"), 14));
  ELSE
    IF OLD."revealAt" IS NOT NULL AND NEW."revealAt" IS DISTINCT FROM OLD."revealAt" THEN
      RAISE EXCEPTION 'a relation''s reveal date cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."settledAt" IS NOT NULL AND NEW."settledAt" IS DISTINCT FROM OLD."settledAt" THEN
      RAISE EXCEPTION 'a settled relation cannot be un-settled or re-settled' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- An UPDATE that changes only the legacy "type" re-resolves "typeId" from it.
  IF TG_OP = 'UPDATE' AND NEW."type" IS DISTINCT FROM OLD."type"
     AND NEW."typeId" IS NOT DISTINCT FROM OLD."typeId" THEN
    NEW."typeId" := NULL;
  END IF;

  IF NEW."typeId" IS NULL THEN
    SELECT t."id" INTO NEW."typeId"
      FROM "RelationType" t WHERE t."spaceId" = NEW."spaceId" AND t."slug" = NEW."type";
    IF NEW."typeId" IS NULL THEN
      RAISE EXCEPTION 'unknown relation type' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT t."slug", t."spaceId" INTO t_slug, t_space
    FROM "RelationType" t WHERE t."id" = NEW."typeId";
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing type
  END IF;
  IF t_space IS DISTINCT FROM NEW."spaceId" THEN
    RAISE EXCEPTION 'a relation type must be in the relation''s space' USING ERRCODE = 'check_violation';
  END IF;
  NEW."type" := t_slug;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "ConceptRelation_type_sync" ON "ConceptRelation";
CREATE TRIGGER "ConceptRelation_type_sync"
  BEFORE INSERT OR UPDATE ON "ConceptRelation"
  FOR EACH ROW EXECUTE FUNCTION mm_concept_relation_type_sync();

-- Backfill: the five legacy "type" strings are the built-in slugs, one to one.
UPDATE "ConceptRelation" r
   SET "typeId" = t."id"
  FROM "RelationType" t
 WHERE r."typeId" IS NULL
   AND t."spaceId" = r."spaceId"
   AND t."slug" = r."type";

-- Backfill "revealAt" for relations that predate the column: creation time plus
-- the space's current setting.
UPDATE "ConceptRelation" r
   SET "revealAt" = r."createdAt" + make_interval(days => mm_stance_reveal_days(sp."settings"))
  FROM "Space" sp
 WHERE r."revealAt" IS NULL
   AND sp."id" = r."spaceId";

-- Uniqueness moves from the legacy string to the type FK.
ALTER TABLE "ConceptRelation" DROP CONSTRAINT IF EXISTS "ConceptRelation_source_target_type_key";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConceptRelation_source_target_typeId_key') THEN
    ALTER TABLE "ConceptRelation" ADD CONSTRAINT "ConceptRelation_source_target_typeId_key"
      UNIQUE ("sourceId", "targetId", "typeId");
  END IF;
  -- Every relation has a type once the backfill is complete.
  IF EXISTS (SELECT 1 FROM "ConceptRelation" WHERE "typeId" IS NULL) THEN
    RAISE EXCEPTION 'ConceptRelation rows without a relation type remain after backfill';
  END IF;
  ALTER TABLE "ConceptRelation" ALTER COLUMN "typeId" SET NOT NULL;
  IF EXISTS (SELECT 1 FROM "ConceptRelation" WHERE "revealAt" IS NULL) THEN
    RAISE EXCEPTION 'ConceptRelation rows without a reveal date remain after backfill';
  END IF;
  ALTER TABLE "ConceptRelation" ALTER COLUMN "revealAt" SET NOT NULL;
END
$$;

-- ── Ownership → app ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  f text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    FOREACH t IN ARRAY ARRAY['RelationType', 'ConceptRelationStance'] LOOP
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t
          AND pg_get_userbyid(c.relowner) <> 'app'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I OWNER TO app', t);
      END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['mm_seed_relation_types(uuid)', 'mm_concept_relation_type_sync()', 'mm_stance_reveal_days(jsonb)'] LOOP
      IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = split_part(f, '(', 1)
          AND pg_get_userbyid(p.proowner) <> 'app'
      ) THEN
        EXECUTE 'ALTER FUNCTION public.' || f || ' OWNER TO app';
      END IF;
    END LOOP;
  END IF;
END
$$;

COMMIT;
