-- P0 deterministic paragraph analysis for NOTAS.
-- LiveClassNoteCode remains the user/code vocabulary; this table stores the
-- derived structural snapshot of each paragraph version.

CREATE TABLE IF NOT EXISTS "LiveClassNoteTrace" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id          uuid NOT NULL REFERENCES "LiveClassNote"(id) ON DELETE CASCADE,
  para_index       integer NOT NULL CHECK (para_index >= 0),
  text_hash        char(40) NOT NULL,
  main_theme       text,
  rhetorical_role  text,
  concepts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  relations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnostics      jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_mode    text NOT NULL DEFAULT 'borrador'
    CHECK (analysis_mode IN ('borrador', 'seminario', 'tesis', 'artistico', 'entrega')),
  source           text NOT NULL DEFAULT 'local_nlp'
    CHECK (source IN ('local_nlp', 'manual', 'ai_suggested', 'ai_confirmed')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, para_index, text_hash)
);

CREATE INDEX IF NOT EXISTS "LiveClassNoteTrace_note_current_idx"
  ON "LiveClassNoteTrace" (note_id, para_index, updated_at DESC);
