-- 001 — Deny DELETE on the reference tables (Mitigation A)
--
-- Context: both accounts (operator and client) currently share identical access via
-- `for all to authenticated using (true)`. Supabase blocks a filter-less DELETE, but a
-- match-everything filter satisfies that check:
--
--     DELETE /rest/v1/schools?facility_key=like.*   -- would remove all 1,683 rows
--
-- This file closes that for the three tables the application never deletes from.
--
-- Why RESTRICTIVE rather than rewriting the existing policies:
-- Permissive policies are OR-ed, and each of these tables carries two `for all` permissive
-- policies (a pre-existing admin policy plus "authenticated full access"). Denying DELETE by
-- editing them would mean rewriting both, on every table, with a real chance of clipping
-- access by accident. A restrictive policy is AND-ed with whatever permissive policies exist,
-- so `using (false)` denies DELETE outright while leaving every other grant untouched.
--
-- SELECT must be preserved: `county_engagement_rate` and `county_school_summary` run with
-- security_invoker=on, so they read these base tables as the calling user. Removing SELECT
-- would break the Counties and Reports pages.
--
-- The scraper is unaffected — it connects as the table owner over DATABASE_URL, and owners
-- bypass RLS entirely.
--
-- Reversible: drop the three policies below.

begin;

create policy "deny delete" on public.district
  as restrictive for delete to authenticated using (false);

create policy "deny delete" on public.county
  as restrictive for delete to authenticated using (false);

create policy "deny delete" on public.state
  as restrictive for delete to authenticated using (false);

commit;

-- Review: expect one restrictive DELETE policy per table, permissive policies untouched.
select tablename, policyname, permissive, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('district', 'county', 'state')
order by tablename, permissive, policyname;
