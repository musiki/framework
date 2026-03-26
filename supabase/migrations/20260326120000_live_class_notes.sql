-- Live class notes: per-user, per-day notes with markdown/mermaid/lilypond support.
-- Visible in the room sidebar and in the user's personal dashboard.

CREATE TABLE "LiveClassNote" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId"       uuid        NOT NULL,
  "courseId"     text,
  "roomName"     text,
  "title"        text        NOT NULL DEFAULT '',
  "body"         text        NOT NULL DEFAULT '',
  "renderedHtml" text,
  "noteDate"     date        NOT NULL DEFAULT CURRENT_DATE,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the most common access patterns
CREATE INDEX "LiveClassNote_userId_noteDate_idx"
  ON "LiveClassNote" ("userId", "noteDate" DESC);

CREATE INDEX "LiveClassNote_courseId_noteDate_idx"
  ON "LiveClassNote" ("courseId", "noteDate" DESC)
  WHERE "courseId" IS NOT NULL;

CREATE INDEX "LiveClassNote_roomName_idx"
  ON "LiveClassNote" ("roomName")
  WHERE "roomName" IS NOT NULL;

-- Auto-update updatedAt on change
CREATE OR REPLACE FUNCTION update_live_class_note_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LiveClassNote_updatedAt"
  BEFORE UPDATE ON "LiveClassNote"
  FOR EACH ROW EXECUTE FUNCTION update_live_class_note_updated_at();
