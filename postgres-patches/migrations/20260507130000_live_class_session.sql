BEGIN;

-- RS pod session: named log of resources shared in a live class meeting.
-- Created lazily on first file upload, not on room join.
-- Distinct from LiveClassSession (livekit attendance tracking).

CREATE TABLE "ResourceSession" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomName"  text        NOT NULL,
  "name"      text        NOT NULL,
  "courseId"  text,
  "claseId"   text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ResourceSession_room_idx"
  ON "ResourceSession" ("roomName", "createdAt" DESC);

-- Resources can optionally belong to a ResourceSession (SA uploads → "media" folder).
-- claseId stays independent; both can coexist.
ALTER TABLE "LiveClassResource"
  ADD COLUMN "sessionId" uuid REFERENCES "ResourceSession"("id") ON DELETE SET NULL;

CREATE INDEX "LiveClassResource_session_idx"
  ON "LiveClassResource" ("sessionId");

COMMIT;
