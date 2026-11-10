-- 025 — Two-step sign-in (aal2) only for editors and admins; viewers read with a password session
--
-- APPLIED 2026-11-09 in the Supabase SQL Editor.
--
-- Why: sign-up is now open to any email address (the db/004 hook is switched off). The
-- authenticator step used to prove "a real SIUE person"; with open sign-up it no longer
-- does, and it was the main thing standing between a new account and the app. New accounts
-- are viewers (db/023), so they should be able to read after confirming their email,
-- without enrolling an authenticator. Anyone who can CHANGE anything still needs it.
--
-- The rule after this file:
--   * viewer  — signs in with email + password (and the confirmation email once). Reads
--               every table, as before. Writes nothing.
--   * editor / admin — must also complete the authenticator step (aal2) before the database
--               treats them as an editor or admin. At aal1 they are a viewer: they can read,
--               every write fails with 42501, and they can't read or change roles.
--
-- How it works: public.app_role() — which is_admin() and can_edit() are built on, and so
-- every "Editors add" / "Editors change" policy (db/023) and the admin-only policies (023,
-- 024) — now returns 'viewer' unless the session is aal2. So the aal2 requirement for
-- writes moves into the role check instead of a separate rule on each table.
--
-- What it changes:
--   1. public.assigned_role() — NEW. The role the account was given, whatever the session's
--      level. The app uses it to decide whether to send someone through the authenticator
--      screens. security definer, returns only the caller's own role.
--   2. public.app_role() — now the EFFECTIVE role: the assigned role at aal2, 'viewer' below.
--   3. The restrictive "Require MFA (aal2)" policy is dropped from the tables viewers must
--      read: schools, staff, contacts, events, programs, activities, import_batches (all
--      writes there are still covered by "Editors add" / "Editors change" and "deny delete")
--      and bug_reports (so a viewer can report a problem).
--
-- NOT changed: "Require MFA (aal2)" stays on user_roles and role_changes (only admins use
-- them, and admins are at aal2 anyway). county, district and state were never gated for
-- reading. Deletes stay denied for everyone. The scraper and the SQL Editor (table owner)
-- are unaffected.
--
-- Order: apply this file FIRST, then deploy the app. The old app keeps working against it
-- (everyone is still sent to the authenticator screens). The new app, deployed before this
-- file, falls back to requiring the authenticator for everyone until assigned_role exists.
--
-- Known limit: a viewer promoted to editor has to reload (and then enrol an authenticator)
-- before the app shows edit controls. Until they do, the database treats them as a viewer.
--
-- BEFORE APPLYING (read-only). Paste the outputs, inside a comment, into "Checked before
-- applying" at the bottom.
--   -- 1. Expect exactly these ten rows (policy "Require MFA (aal2)", RESTRICTIVE):
--   --    activities, bug_reports, contacts, events, import_batches, programs, role_changes,
--   --    schools, staff, user_roles
--   select tablename, permissive from pg_policies
--   where schemaname = 'public' and policyname = 'Require MFA (aal2)' order by 1;
--   -- 2. Expect "Editors add" and "Editors change" on the seven data tables (14 rows).
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and policyname in ('Editors add', 'Editors change')
--     and tablename in ('schools','staff','contacts','events','programs','activities','import_batches')
--   order by 1, 2;
--   -- 3. Expect "deny delete" on the same seven tables.
--   select tablename from pg_policies
--   where schemaname = 'public' and policyname = 'deny delete'
--     and tablename in ('schools','staff','contacts','events','programs','activities','import_batches')
--   order by 1;
--   -- 4. Every editor and admin has a verified authenticator, or they will be stuck as
--   --    viewers until they enrol one. Expect a row per editor/admin with factors >= 1.
--   select r.email, r.role,
--          (select count(*) from auth.mfa_factors f
--           where f.user_id = r.user_id and f.status = 'verified') as factors
--   from public.user_roles r where r.role in ('admin', 'editor') and not r.archived order by 2, 1;
--
-- Reversible: see REVERSE at the bottom.

begin;

-- 0. Snapshot of the policies this changes, and a stop if the safety net isn't in place.
create schema if not exists backup;
create table backup.policies_before_025 as
  select * from pg_policies where schemaname = 'public';

do $guard$
declare
  t text;
begin
  foreach t in array array['schools', 'staff', 'contacts', 'events', 'programs', 'activities',
                           'import_batches'] loop
    if (select count(*) from pg_policies
        where schemaname = 'public' and tablename = t
          and policyname in ('Editors add', 'Editors change', 'deny delete')) <> 3 then
      raise exception 'public.% is missing "Editors add", "Editors change" or "deny delete". Nothing was changed.', t;
    end if;
  end loop;
  if to_regprocedure('public.can_edit()') is null or to_regprocedure('public.app_role()') is null then
    raise exception 'db/023 (roles) is not applied. Nothing was changed.';
  end if;
end
$guard$;

-- 1. The role the account was given, at any sign-in level.
create or replace function public.assigned_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select r.role from public.user_roles r where r.user_id = auth.uid() and not r.archived),
    'viewer'
  );
$fn$;

revoke all on function public.assigned_role() from public, anon;
grant execute on function public.assigned_role() to authenticated;

-- 2. The effective role: editors and admins count as such only on an aal2 session.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when (auth.jwt() ->> 'aal') = 'aal2' then public.assigned_role()
    else 'viewer'
  end;
$fn$;

-- 3. Viewers read these tables at aal1, so the blanket aal2 rule goes. Writes stay
--    covered: "Editors add" / "Editors change" (can_edit, now aal2-gated) and "deny delete".
do $drop$
declare
  t text;
begin
  foreach t in array array['schools', 'staff', 'contacts', 'events', 'programs', 'activities',
                           'import_batches', 'bug_reports'] loop
    execute format('drop policy if exists "Require MFA (aal2)" on public.%I', t);
  end loop;
end
$drop$;

commit;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- TEST 1 — policies. Expect "Require MFA (aal2)" on exactly two tables: role_changes and
-- user_roles.
/*
select tablename, permissive from pg_policies
where schemaname = 'public' and policyname = 'Require MFA (aal2)' order by 1;
*/

-- TEST 2 — functions. Expect assigned_role: security definer, search_path="", executable
-- by signed-in users only (not anon).
/*
select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in ('assigned_role', 'app_role');
*/

-- TEST 3 — the real behaviour, as an existing editor, in a transaction that is rolled back.
-- Run the whole block at once. Replace the email if sbloodw@siue.edu isn't an editor.
-- Expect NOTICEs: aal1 -> app_role viewer, assigned_role editor, read ok, write refused;
--                 aal2 -> app_role editor, write ok (then rolled back).
/*
begin;
do $t$
declare
  uid uuid := (select id from auth.users where lower(email) = 'sbloodw@siue.edu');
  n bigint;
  key text := (select facility_key from public.schools limit 1);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  raise notice 'aal1: app_role=%, assigned_role=%', public.app_role(), public.assigned_role();
  select count(*) into n from public.schools;
  raise notice 'aal1: can read % schools', n;
  begin
    update public.schools set notes = notes where facility_key = key;
    raise notice 'aal1: write ALLOWED (this is wrong)';
  exception when insufficient_privilege then
    raise notice 'aal1: write refused (expected)';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  raise notice 'aal2: app_role=%', public.app_role();
  update public.schools set notes = notes where facility_key = key;
  raise notice 'aal2: write ok (rolled back below)';
end
$t$;
rollback;
*/

-- TEST 4 — a viewer (any non-editor account) at aal1 reads and can't write. Expect a
-- read count > 0 and "write refused". Replace the email with any viewer's.
/*
begin;
do $t$
declare
  uid uuid := (select id from auth.users where lower(email) = 'someviewer@example.com');
  n bigint;
  key text := (select facility_key from public.schools limit 1);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.staff;
  raise notice 'viewer aal1: can read % staff rows', n;
  begin
    update public.schools set notes = notes where facility_key = key;
    raise notice 'viewer: write ALLOWED (this is wrong)';
  exception when insufficient_privilege then
    raise notice 'viewer: write refused (expected)';
  end;
end
$t$;
rollback;
*/

-- TEST 5 — outside-in, with the public key and a viewer's password-only session token:
-- GET /rest/v1/staff?select=staff_id&limit=1 should now return a row (it returned [] at
-- aal1 before this file). A PATCH on /rest/v1/schools must fail with 42501.


-- ============================================================================
-- REVERSE (puts back the old app_role and the aal2 rule; drops assigned_role)
-- ============================================================================
/*
begin;
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select r.role from public.user_roles r where r.user_id = auth.uid() and not r.archived),
    'viewer'
  );
$fn$;

do $redo$
declare
  t text;
begin
  foreach t in array array['schools', 'staff', 'contacts', 'events', 'programs', 'activities',
                           'import_batches', 'bug_reports'] loop
    execute format('drop policy if exists "Require MFA (aal2)" on public.%I', t);
    execute format('create policy "Require MFA (aal2)" on public.%I as restrictive for all to authenticated using ((auth.jwt() ->> ''aal'') = ''aal2'') with check ((auth.jwt() ->> ''aal'') = ''aal2'')', t);
  end loop;
end
$redo$;

drop function public.assigned_role();
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING outputs here, inside a comment)
-- ============================================================================