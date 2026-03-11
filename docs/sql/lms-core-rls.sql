-- LMS core tables RLS hardening (Supabase)
-- Fixes linter warning: rls_disabled_in_public
-- Tables: public."User", public."Enrollment", public."Assignment", public."Submission"
--
-- This project currently performs DB access from server routes.
-- Recommended model:
-- 1) Use service role key only on server env.
-- 2) Keep client roles (anon/authenticated) blocked on these tables.

begin;

alter table if exists public."User" enable row level security;
alter table if exists public."Enrollment" enable row level security;
alter table if exists public."Assignment" enable row level security;
alter table if exists public."Submission" enable row level security;

revoke all on table public."User" from anon, authenticated;
revoke all on table public."Enrollment" from anon, authenticated;
revoke all on table public."Assignment" from anon, authenticated;
revoke all on table public."Submission" from anon, authenticated;

grant all on table public."User" to service_role;
grant all on table public."Enrollment" to service_role;
grant all on table public."Assignment" to service_role;
grant all on table public."Submission" to service_role;

drop policy if exists "service_role_only" on public."User";
create policy "service_role_only"
on public."User"
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_only" on public."Enrollment";
create policy "service_role_only"
on public."Enrollment"
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_only" on public."Assignment";
create policy "service_role_only"
on public."Assignment"
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_only" on public."Submission";
create policy "service_role_only"
on public."Submission"
as permissive
for all
to service_role
using (true)
with check (true);

commit;

-- Optional verification queries:
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in ('User', 'Enrollment', 'Assignment', 'Submission');
--
-- select schemaname, tablename, policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('User', 'Enrollment', 'Assignment', 'Submission')
-- order by tablename, policyname;
