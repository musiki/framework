-- RLS not required: app user has Bypass RLS privilege.
-- Table is server-side only; all access goes through the API layer (pool.ts).
-- Keeping this file as a no-op placeholder for migration history consistency.

-- If additional DB roles are added in the future, add policies here:
-- ALTER TABLE public."LiveClassResource" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "app_only" ON public."LiveClassResource"
--   AS PERMISSIVE FOR ALL TO app USING (true) WITH CHECK (true);
