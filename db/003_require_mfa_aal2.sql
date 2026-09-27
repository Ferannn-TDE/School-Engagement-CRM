-- 003 — Require a completed 2FA sign-in (aal2) on the six data tables
--
-- Documentation only: this recreates policies that already exist. They were first added by
-- hand in the Supabase dashboard (alongside commit 0d97b37, which added the 2FA sign-in
-- screens) and had no record in git. Running this file changes no behaviour; it exists so
-- the live policy set can be reviewed and rebuilt from the repo. Captured from pg_policies
-- on 2026-09-26.
--
-- How the gate works:
-- RESTRICTIVE policies are AND-ed with the permissive ones, so each table's effective rule is
--     (any permissive policy) AND (aal = 'aal2')
-- Every gated table also carries two permissive `for all … using (true)` policies,
-- "authenticated full access" and "Allow auth admin to manage …". They are deliberately left
-- in place: the restrictive policy below is what narrows access, not their absence. Note that
-- despite its name, the "Allow auth admin" policy is granted to `authenticated`, not to
-- `supabase_auth_admin` — it is a second open policy, not an admin-only one.
--
-- Verified outside-in on 2026-09-26 with the real publishable key:
--     no login            -> 401 42501 permission denied (every table)
--     signed in, aal1     -> 200, 0 rows (filtered by this policy)
--     signed in, aal2     -> real rows (schools 1,687, staff 4,243, contacts 2,936, events 165)
--
-- NOT GATED — county, district and state have no aal2 policy. A password-only (aal1) session
-- can still read them. They are lookup tables of place names (county_name; district_name +
-- county_name) with no personal data, so this is low risk, but it was not recorded as a
-- deliberate decision when the policies were added. Do not assume every table is gated.
-- The county views (county_engagement_rate, county_school_summary) run with
-- security_invoker=on and read `schools`, so their school figures are still gated through it.
--
-- Order matters if this is ever applied to a fresh project: an account with no verified
-- authenticator can only ever reach aal1, and these policies will show it an empty app.
-- Enroll and confirm aal2 on every account first.
--
-- Reversible: drop the six policies named "Require MFA (aal2)".

begin;

drop policy if exists "Require MFA (aal2)" on public.schools;
create policy "Require MFA (aal2)" on public.schools
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require MFA (aal2)" on public.staff;
create policy "Require MFA (aal2)" on public.staff
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require MFA (aal2)" on public.contacts;
create policy "Require MFA (aal2)" on public.contacts
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require MFA (aal2)" on public.events;
create policy "Require MFA (aal2)" on public.events
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require MFA (aal2)" on public.activities;
create policy "Require MFA (aal2)" on public.activities
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists "Require MFA (aal2)" on public.programs;
create policy "Require MFA (aal2)" on public.programs
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');

commit;

-- Review: expect exactly six rows, all RESTRICTIVE, none on county, district or state.
select tablename, policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and policyname = 'Require MFA (aal2)'
order by tablename;
