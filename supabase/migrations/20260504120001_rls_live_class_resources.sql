BEGIN;

ALTER TABLE public."LiveClassResource" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."LiveClassResource" FROM anon, authenticated;
GRANT ALL ON TABLE public."LiveClassResource" TO service_role;

DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassResource";
CREATE POLICY "service_role_only"
  ON public."LiveClassResource"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
