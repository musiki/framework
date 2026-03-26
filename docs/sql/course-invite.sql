-- CourseInvite: pre-registration whitelist per course.
-- Teachers add student emails here via the dashboard import button.
-- Students can only self-enroll (Inscribirse) if their email appears here.

CREATE TABLE IF NOT EXISTS "CourseInvite" (
  "id"              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  "courseId"        text        NOT NULL,
  "email"           text        NOT NULL,
  "createdByUserId" text,
  "createdAt"       timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "CourseInvite_courseId_email_key" UNIQUE ("courseId", "email")
);

-- Only the service role (server-side API) can read/write this table.
ALTER TABLE "CourseInvite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role only" ON "CourseInvite"
  FOR ALL TO service_role USING (true) WITH CHECK (true);
