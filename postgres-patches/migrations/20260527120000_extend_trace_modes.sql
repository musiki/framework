-- Extend LiveClassNoteTrace and LiveClassNoteCode to support new modes, paragraph id, rhythm and sentences analysis.

ALTER TABLE "LiveClassNoteTrace" DROP CONSTRAINT IF EXISTS "LiveClassNoteTrace_analysis_mode_check";

ALTER TABLE "LiveClassNoteTrace"
ADD COLUMN IF NOT EXISTS paragraph_id TEXT,
ADD COLUMN IF NOT EXISTS rhythm JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS sentences JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'academic';

ALTER TABLE "LiveClassNoteCode"
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'academic',
ADD COLUMN IF NOT EXISTS dimension TEXT DEFAULT 'thematic';
