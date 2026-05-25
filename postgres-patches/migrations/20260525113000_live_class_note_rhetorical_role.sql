-- Each paragraph may have at most one manually selected rhetorical role.

CREATE UNIQUE INDEX IF NOT EXISTS "LiveClassNoteCode_one_rhetorical_role_idx"
  ON "LiveClassNoteCode" (note_id, para_index)
  WHERE dimension = 'rhetorical';
