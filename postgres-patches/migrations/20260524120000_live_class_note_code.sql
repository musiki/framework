-- Create LiveClassNoteCode table for trace code annotations
CREATE TABLE IF NOT EXISTS "LiveClassNoteCode" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES "LiveClassNote"(id) ON DELETE CASCADE,
  para_index  integer NOT NULL,
  label       text NOT NULL,
  dimension   text NOT NULL DEFAULT 'manual',
  source      text NOT NULL DEFAULT 'manual',
  confidence  real NOT NULL DEFAULT 1.0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (note_id, para_index, label)
);

CREATE INDEX IF NOT EXISTS "LiveClassNoteCode_note_id_idx"
  ON "LiveClassNoteCode" (note_id);
