-- LMS core tables RLS hardening (Supabase)
-- Fixes linter warning: rls_disabled_in_public
-- Tables: public."User", public."Enrollment", public."Assignment", public."Submission"

BEGIN;

-- Enable RLS for all core tables
ALTER TABLE IF EXISTS public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."Submission" ENABLE ROW LEVEL SECURITY;

-- Revoke all from non-service roles for extra safety
REVOKE ALL ON TABLE public."User" FROM anon, authenticated;
REVOKE ALL ON TABLE public."Enrollment" FROM anon, authenticated;
REVOKE ALL ON TABLE public."Assignment" FROM anon, authenticated;
REVOKE ALL ON TABLE public."Submission" FROM anon, authenticated;

-- Grant all to service_role (which is what the Astro API routes use)
GRANT ALL ON TABLE public."User" TO service_role;
GRANT ALL ON TABLE public."Enrollment" TO service_role;
GRANT ALL ON TABLE public."Assignment" TO service_role;
GRANT ALL ON TABLE public."Submission" TO service_role;

-- Create policies to allow everything to service_role
DROP POLICY IF EXISTS "service_role_only" ON public."User";
CREATE POLICY "service_role_only"
  ON public."User"
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only" ON public."Enrollment";
CREATE POLICY "service_role_only"
  ON public."Enrollment"
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only" ON public."Assignment";
CREATE POLICY "service_role_only"
  ON public."Assignment"
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_only" ON public."Submission";
CREATE POLICY "service_role_only"
  ON public."Submission"
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
