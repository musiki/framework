BEGIN;

-- RoomSnapshot: stores the complete state of a room (all pods, positions, and core settings).
CREATE TABLE "RoomSnapshot" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomName"    text        NOT NULL,
  "courseId"    text,
  "claseId"     text,
  "name"        text        NOT NULL,
  "layout"      jsonb       NOT NULL, -- Dockview layout + settings
  "createdBy"   text        NOT NULL, -- identity
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "RoomSnapshot_room_idx"
  ON "RoomSnapshot" ("roomName", "createdAt" DESC);

COMMIT;
