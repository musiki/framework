BEGIN;

-- LiveClassNoteShare: Store sharing permissions for notes
CREATE TABLE IF NOT EXISTS public."LiveClassNoteShare" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "noteId"       uuid        NOT NULL REFERENCES public."LiveClassNote"("id") ON DELETE CASCADE,
  "sharedBy"     uuid        NOT NULL,
  "targetType"   varchar(50) NOT NULL, -- 'user', 'class', 'teachers', 'students'
  "targetId"     text        NOT NULL, -- specific user uuid, class/commission id, or course ID
  "accessLevel"  varchar(20) NOT NULL DEFAULT 'view', -- 'view', 'comment', 'edit'
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for LiveClassNoteShare
CREATE INDEX IF NOT EXISTS "LiveClassNoteShare_noteId_idx" ON public."LiveClassNoteShare" ("noteId");
CREATE INDEX IF NOT EXISTS "LiveClassNoteShare_target_idx" ON public."LiveClassNoteShare" ("targetType", "targetId");

-- LiveClassNoteAnnotation: Store highlighted selection quotes and root comments
CREATE TABLE IF NOT EXISTS public."LiveClassNoteAnnotation" (
  "id"          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "noteId"      uuid        NOT NULL REFERENCES public."LiveClassNote"("id") ON DELETE CASCADE,
  "authorId"    uuid        NOT NULL,
  "quote"       text        NOT NULL, -- selected text snippet
  "anchorJson"  jsonb       NOT NULL, -- anchoring offset, context prefix/suffix
  "body"        text        NOT NULL, -- root comment text
  "isResolved"  boolean     NOT NULL DEFAULT false,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

-- Indexes for LiveClassNoteAnnotation
CREATE INDEX IF NOT EXISTS "LiveClassNoteAnnotation_noteId_idx" ON public."LiveClassNoteAnnotation" ("noteId");

-- LiveClassNoteComment: Threaded replies to annotations
CREATE TABLE IF NOT EXISTS public."LiveClassNoteComment" (
  "id"           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "annotationId" uuid        NOT NULL REFERENCES public."LiveClassNoteAnnotation"("id") ON DELETE CASCADE,
  "authorId"     uuid        NOT NULL,
  "body"         text        NOT NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for LiveClassNoteComment
CREATE INDEX IF NOT EXISTS "LiveClassNoteComment_annotationId_idx" ON public."LiveClassNoteComment" ("annotationId");

-- LiveClassNoteVersion: Snapshots for note revision history
CREATE TABLE IF NOT EXISTS public."LiveClassNoteVersion" (
  "id"          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "noteId"      uuid        NOT NULL REFERENCES public."LiveClassNote"("id") ON DELETE CASCADE,
  "title"       text        NOT NULL,
  "body"        text        NOT NULL,
  "versionName" varchar(200) NOT NULL,
  "createdById" uuid        NOT NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

-- Indexes for LiveClassNoteVersion
CREATE INDEX IF NOT EXISTS "LiveClassNoteVersion_noteId_idx" ON public."LiveClassNoteVersion" ("noteId", "createdAt" DESC);

-- Enable RLS for the new tables
ALTER TABLE public."LiveClassNoteShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiveClassNoteAnnotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiveClassNoteComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiveClassNoteVersion" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Revoke all from non-service roles if they exist
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."LiveClassNoteShare" FROM anon, authenticated;
    REVOKE ALL ON TABLE public."LiveClassNoteAnnotation" FROM anon, authenticated;
    REVOKE ALL ON TABLE public."LiveClassNoteComment" FROM anon, authenticated;
    REVOKE ALL ON TABLE public."LiveClassNoteVersion" FROM anon, authenticated;
  END IF;

  -- Grant all to service_role and create policies if service_role exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public."LiveClassNoteShare" TO service_role;
    GRANT ALL ON TABLE public."LiveClassNoteAnnotation" TO service_role;
    GRANT ALL ON TABLE public."LiveClassNoteComment" TO service_role;
    GRANT ALL ON TABLE public."LiveClassNoteVersion" TO service_role;

    DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassNoteShare";
    CREATE POLICY "service_role_only" ON public."LiveClassNoteShare" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassNoteAnnotation";
    CREATE POLICY "service_role_only" ON public."LiveClassNoteAnnotation" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassNoteComment";
    CREATE POLICY "service_role_only" ON public."LiveClassNoteComment" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassNoteVersion";
    CREATE POLICY "service_role_only" ON public."LiveClassNoteVersion" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$$;

COMMIT;
