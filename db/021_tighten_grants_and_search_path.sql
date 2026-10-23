-- 021 — Narrow what signed-in users may do to tables, and fix the search_path on four functions
--
-- Applied 2026-10-23 in the SQL Editor; TEST 6b and TEST 7 passed, and the signup hook refused a gmail sign-up (403).
--
-- Why (from the read-only grant queries run on 2026-10-20):
--   * authenticated holds TRUNCATE, TRIGGER and REFERENCES on every public table, and
--     INSERT/UPDATE/DELETE on the two county views. These are Supabase's default grants.
--     TRUNCATE is not covered by RLS, so it skips the deny-delete policies (db/010) and the
--     100-row bulk-delete guard (db/002, which fires on DELETE only). PostgREST has no
--     truncate endpoint, so this is not reachable from the app today; it is reachable from
--     any future function that runs SQL as the caller. Deletes are already refused by
--     policy, so DELETE goes too and the refusal becomes a clear permission error.
--   * guard_bulk_delete, hook_restrict_signup_to_siue, protect_manual_edits and
--     stamp_archive run with whatever search_path the caller has. None of them names a
--     table (guard_bulk_delete reads only its "deleted" transition table, which is not a
--     schema object), and everything else they use is in pg_catalog, which is always
--     searched, so an empty search_path changes nothing they do.
--   * restrict_signup_domain is an old function, not created by any file in db/, not
--     attached to any trigger and not the signup hook (the hook is
--     hook_restrict_signup_to_siue). It is removed so nobody mistakes it for the gate.
--
--   * Confirmed 2026-10-20: anon holds no privilege on any public table or view (the
--     grant query returned rows for authenticated only), so anon is not covered here.
--     No function in public is security definer.
--
-- One visible change: a delete sent with a signed-in user's token used to remove 0 rows
-- with no error (the deny-delete policies in 010 filter silently). After this it fails
-- with "permission denied for table ..." (42501). db/README.md is updated for this in
-- the same commit. Nothing needs DELETE: src/ has no database delete (verify:no-deletes),
-- archive_school/restore_school/archive_contact/restore_contact and stamp_archive only
-- update, the app's two upserts need INSERT and UPDATE only, and the only DELETE
-- statements in db/ are the commented-out tests in 002, which run as the owner.
--
-- What does NOT change:
--   * The scraper connects as postgres, the owner of these tables. Owners are not limited
--     by grants, so the scraper can still read, insert and update exactly as before.
--   * service_role, and the app's sign-in through Supabase Auth.
--   * Every RLS policy. Signed-in users keep SELECT, INSERT and UPDATE on tables and
--     SELECT on the views, which is everything the app uses (npm run verify:no-deletes
--     shows the app never deletes).
--   * No data is touched. No table or column is dropped.
--
-- BEFORE APPLYING (read-only), and paste the outputs into the "Saved before applying"
-- block at the bottom of this file, so the old function can be recreated if ever needed:
--   select p.oid::regprocedure, pg_get_functiondef(p.oid)
--   from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'restrict_signup_domain';
--
--   -- must return no rows, or the drop below stops with an error
--   select tgname, tgrelid::regclass from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--   where p.proname = 'restrict_signup_domain';
--
-- Later migrations: a "create or replace function" on any of the four functions must
-- repeat "set search_path = ''", or the fix is lost.
--
-- Reversible: see REVERSE at the bottom.

begin;

-- 1. Tables: signed-in users keep SELECT, INSERT and UPDATE. ("all tables" includes views
--    in Postgres; revoking these from a view is harmless.)
revoke truncate, trigger, references, delete
  on all tables in schema public from authenticated;

-- 2. Views: read only.
revoke insert, update, delete
  on public.county_engagement_rate, public.county_school_summary from authenticated;

-- 3. The same for tables created later by postgres (the role that runs these migrations),
--    so a new table doesn't arrive with the old defaults.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, delete on tables from authenticated;

-- 4. Fixed search_path.
alter function public.guard_bulk_delete()                 set search_path = '';
alter function public.hook_restrict_signup_to_siue(jsonb) set search_path = '';
alter function public.protect_manual_edits()              set search_path = '';
alter function public.stamp_archive()                     set search_path = '';

-- 5. Remove restrict_signup_domain, whatever its arguments, unless a trigger uses it.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'restrict_signup_domain'
  loop
    if exists (select 1 from pg_trigger where tgfoid = f::oid) then
      raise exception '% is used by a trigger; not dropping it', f;
    end if;
    execute format('drop function %s', f);
  end loop;
end
$$;

commit;


-- ============================================================================
-- VERIFICATION (all read-only)
-- ============================================================================

-- TEST 1 — what authenticated may do now. Expect every table: INSERT, SELECT, UPDATE;
-- county_engagement_rate and county_school_summary: SELECT. Nothing else.
/*
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
group by table_name order by table_name;
*/

-- TEST 2 — the specific privileges are gone. Expect every column false.
/*
select c.relname,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE')   as can_truncate,
       has_table_privilege('authenticated', c.oid, 'DELETE')     as can_delete,
       has_table_privilege('authenticated', c.oid, 'TRIGGER')    as can_trigger,
       has_table_privilege('authenticated', c.oid, 'REFERENCES') as can_reference
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'p')
order by 1;
*/

-- TEST 3 — the scraper's owner connection is unaffected. Expect true, true, true for
-- every table, and the owner column to say postgres.
/*
select c.relname, pg_get_userbyid(c.relowner) as owner,
       has_table_privilege('postgres', c.oid, 'SELECT') as can_select,
       has_table_privilege('postgres', c.oid, 'INSERT') as can_insert,
       has_table_privilege('postgres', c.oid, 'UPDATE') as can_update
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
order by 1;
*/

-- TEST 4 — search_path is fixed. Expect {search_path=""} on all four.
/*
select proname, proconfig from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('guard_bulk_delete', 'hook_restrict_signup_to_siue',
                  'protect_manual_edits', 'stamp_archive');
*/

-- TEST 5 — the signup hook still decides the same way (no account is created). Expect
-- {} for the two siue.edu addresses and a 403 error for the other four.
/*
select e, public.hook_restrict_signup_to_siue(jsonb_build_object('user', jsonb_build_object('email', e)))
from unnest(array['allowed@siue.edu', 'Mixed.Case@SIUE.EDU', 'testuser1@gmail.com',
                  'x@siue.edu.example.com', 'x@notsiue.edu', null]) as e;
*/
-- Then the real path, from a terminal with the public key. Expect a 403 with
-- "Only @siue.edu email addresses can sign up." and no new row in auth.users:
--   curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/signup" \
--     -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
--     -d '{"email":"hook-probe@example.com","password":"<random>"}'

-- TEST 6 — restrict_signup_domain is gone. Expect no rows.
/*
select oid::regprocedure from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'restrict_signup_domain';
*/

-- TEST 6b — a delete as a signed-in user is now refused with a permission error, not
-- silently. Rolled back, and "where false" matches no row, so nothing can be removed even
-- if the grant were still there. Expect, for each statement:
--   ERROR: permission denied for table schools  (SQLSTATE 42501)
-- (TRUNCATE is covered by TEST 2; it isn't run here because it has no "where false".)
/*
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
  delete from public.schools where false;
rollback;
*/

-- TEST 7 — the app, signed in with 2FA (by hand, in this order):
--   Dashboard, Schools, a school's page, Contacts, Events, Priorities, Reports, Counties
--   and a county page all load; edit a school's phone and see the lock card logic still
--   work; log a contact; archive a record and restore it from Settings ->
--   Archived; run an import preview to the end without saving.
--   Any "permission denied" in the browser console means a grant was taken that the app
--   uses: stop and run REVERSE.

-- TEST 8 — the scraper, on the throwaway Postgres only (never a Supabase address): apply
-- this file after the test schema and run pytest with SCRAPER_TEST_DATABASE_URL set.


-- ============================================================================
-- REVERSE (only if TEST 7 or TEST 8 fails)
-- ============================================================================
/*
begin;
grant truncate, trigger, references, delete on all tables in schema public to authenticated;
grant insert, update, delete on public.county_engagement_rate, public.county_school_summary to authenticated;
alter default privileges for role postgres in schema public
  grant truncate, trigger, references, delete on tables to authenticated;
alter function public.guard_bulk_delete()                 reset search_path;
alter function public.hook_restrict_signup_to_siue(jsonb) reset search_path;
alter function public.protect_manual_edits()              reset search_path;
alter function public.stamp_archive()                     reset search_path;
-- restrict_signup_domain: recreate from the definition saved below, if wanted.
commit;
*/


-- ============================================================================
-- Saved before applying (paste the BEFORE APPLYING outputs here)
-- ============================================================================
-- restrict_signup_domain definition (captured 2026-10-23, before applying; it was
-- attached to no trigger). To recreate it, remove the comment markers and run it.
/*
CREATE OR REPLACE FUNCTION public.restrict_signup_domain(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  user_email text;
begin
  user_email := event->'user'->>'email';

  if user_email is null or user_email !~* '@siue\.edu$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Only @siue.edu email addresses are allowed to register.'
      )
    );
  end if;

  return jsonb_build_object('decision', 'continue');
end;
$function$
*/
