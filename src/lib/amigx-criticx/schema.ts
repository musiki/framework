import { query } from '../db/pool';

let ensurePromise: Promise<void> | null = null;

export const amigxCriticxSchemaSql = `
CREATE TABLE IF NOT EXISTS "AmigxCriticxReview" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "courseId"             text        NOT NULL DEFAULT 's123',
  "authorUserId"         uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "recipientUserId"      uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "descripcion"          text        NOT NULL DEFAULT '',
  "funcionaNoFunciona"   text        NOT NULL DEFAULT '',
  "hariaDistinto"        text        NOT NULL DEFAULT '',
  "recipientResponse"    text        NOT NULL DEFAULT '',
  "recipientRespondedAt" timestamptz,
  "isPublic"             boolean     NOT NULL DEFAULT false,
  "status"               text        NOT NULL DEFAULT 'claimed',
  "submittedAt"          timestamptz,
  "createdAt"            timestamptz NOT NULL DEFAULT now(),
  "updatedAt"            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmigxCriticxReview_no_self_check') THEN
    ALTER TABLE "AmigxCriticxReview"
      ADD CONSTRAINT "AmigxCriticxReview_no_self_check"
      CHECK ("authorUserId" <> "recipientUserId");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmigxCriticxReview_status_check') THEN
    ALTER TABLE "AmigxCriticxReview"
      ADD CONSTRAINT "AmigxCriticxReview_status_check"
      CHECK ("status" IN ('claimed', 'submitted'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmigxCriticxReview_course_author_key') THEN
    ALTER TABLE "AmigxCriticxReview"
      ADD CONSTRAINT "AmigxCriticxReview_course_author_key"
      UNIQUE ("courseId", "authorUserId");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmigxCriticxReview_course_recipient_key') THEN
    ALTER TABLE "AmigxCriticxReview"
      ADD CONSTRAINT "AmigxCriticxReview_course_recipient_key"
      UNIQUE ("courseId", "recipientUserId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AmigxCriticxReview_course_idx"
  ON "AmigxCriticxReview" ("courseId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "AmigxCriticxReview_recipient_idx"
  ON "AmigxCriticxReview" ("courseId", "recipientUserId");
`;

export async function ensureAmigxCriticxSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const result = await query(amigxCriticxSchemaSql, undefined, 1);
      if (result.error) {
        ensurePromise = null;
        throw result.error;
      }
    })();
  }
  return ensurePromise;
}
