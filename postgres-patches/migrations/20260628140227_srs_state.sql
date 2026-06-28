BEGIN;

-- SrsState: spaced-repetition scheduling state per (user, eval item).
-- Driven by eval blocks that declare `spaced.enabled: true`. See s123/EVALUATION.md §5–§6.
CREATE TABLE IF NOT EXISTS "SrsState" (
  "userId"         text        NOT NULL,
  "evalId"         text        NOT NULL,
  "deck"           text        NOT NULL DEFAULT 'default',
  "reps"           integer     NOT NULL DEFAULT 0,      -- n: correct reps in a row
  "easeFactor"     numeric     NOT NULL DEFAULT 2.5,    -- EF
  "intervalDays"   integer     NOT NULL DEFAULT 0,      -- I
  "dueAt"          timestamptz NOT NULL DEFAULT now(),
  "lastQuality"    integer,                             -- q of last review
  "lastReviewedAt" timestamptz,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "evalId")
);

CREATE INDEX IF NOT EXISTS "SrsState_due_idx"
  ON "SrsState" ("userId", "dueAt");

CREATE INDEX IF NOT EXISTS "SrsState_deck_idx"
  ON "SrsState" ("userId", "deck", "dueAt");

COMMIT;
