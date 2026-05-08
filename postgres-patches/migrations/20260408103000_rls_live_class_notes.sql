-- Enable RLS for LiveClassNote table to silence Supabase linter warning
-- This table is currently accessed via BFF (server routes) using the service role key.

BEGIN;

ALTER TABLE public."LiveClassNote" ENABLE ROW LEVEL SECURITY;

-- Revoke all from non-service roles for extra safety
REVOKE ALL ON TABLE public."LiveClassNote" FROM anon, authenticated;

-- Grant all to service_role (which is what the Astro API routes use)
GRANT ALL ON TABLE public."LiveClassNote" TO service_role;

-- Create policy to allow everything to service_role
DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassNote";
CREATE POLICY "service_role_only"
  ON public."LiveClassNote"
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
