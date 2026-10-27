-- 023 — Roles: admin, editor, viewer
--
-- DRAFT, NOT APPLIED. Review, run the BEFORE APPLYING checks, then apply in the SQL
-- Editor and run the verification below.
--
-- Why: until now every signed-in @siue.edu account could change everything. From here:
--   * admin  — everything, including managing roles (Settings → Team) and reading every
--              problem report (024).
--   * editor — read and change data.
--   * viewer — read only. New sign-ups start here; an admin grants edit access.
-- The database enforces it, not the app: every data table gets a restrictive policy
-- that lets a row be added or changed only by an editor or admin, next to the aal2 rule
-- (db/003). A viewer's write fails with a permission error ("new row violates
-- row-level security policy", 42501); nothing is filtered silently. The app hides edit
-- buttons for viewers too, but that is convenience, not the check.
--
-- What it adds:
--   * public.user_roles — one row per account, keyed by the account's id (not email;
--     the email is kept only to show who it is). archived = taken off the team: the
--     account counts as a viewer. Rows are created for every existing account here,
--     and for every new account by a trigger on auth.users. Nobody inserts them by hand.
--   * public.role_changes — every change to a role row: who, whom, old and new role and
--     archived state, when. Append-only: no grant lets anyone change it, and a trigger
--     refuses UPDATE, DELETE and TRUNCATE even from the owner.
--   * public.app_role() — the signed-in account's role ('viewer' with no active row).
--     security definer, because the policies on user_roles use it and a plain function
--     would recurse into those same policies. It returns only the caller's own role.
--     public.is_admin() and public.can_edit() wrap it.
--   * Nothing here has a foreign key to auth.users, so deleting or banning an account
--     is never blocked by its role row or its log entries. The row stays behind, but
--     it no longer counts towards "at least one admin" (see guard_role_change).
--   * guard_role_change (before update on user_roles), for requests from the app:
--       - only admins change roles;
--       - nobody raises their own role;
--       - the last active admin can't be demoted or archived (also for the owner, so the
--         SQL Editor can't lock everyone out by accident). Only admins whose account
--         still exists in auth.users and isn't banned count, so a deleted or banned
--         admin's leftover row can't let the last real admin step down. An advisory lock
--         makes two admins demoting each other at the same moment wait for each other;
--       - user_id and email can't be changed; updated_at/updated_by are stamped.
--   * Protections on both tables, as on every data table: RLS, aal2, deny delete, the
--     bulk-delete guard, archive stamps, SELECT and UPDATE only (user_roles) or SELECT
--     only (role_changes) for signed-in users, nothing for anon. On user_roles a user
--     reads their own row and admins read all; on role_changes only admins read.
--
-- Not affected: the scraper and the SQL Editor connect as the table owner, which RLS
-- doesn't apply to, so they write exactly as before (TEST 5 checks this). The signup
-- hook (004) still decides who may sign up; this decides what they may do after.
--
-- Accounts set here (by email, once, to find each account's id; from then on by id):
--   admin:  oodedai@siue.edu, feranmidyro@gmail.com, cgordon@siue.edu
--   editor: chbruce@siue.edu, sbloodw@siue.edu
--   viewer: every other existing account
-- If any of those five emails has no account, the migration stops and changes nothing.
--
-- Snapshot: step 0 saves every policy in the public schema to
-- backup.policies_before_023, the only existing thing this changes.
--
-- BEFORE APPLYING (read-only). Paste the outputs, inside a comment, into "Checked
-- before applying" at the bottom.
--   -- 1. The accounts. Expect the five emails above among them.
--   select id, email, created_at from auth.users order by email;
--   -- 2. Nothing is called user_roles or role_changes yet. Expect two nulls.
--   select to_regclass('public.user_roles'), to_regclass('public.role_changes');
--   -- 3. The ten tables that get the editor rule all exist with RLS on. Expect 10 rows, all true.
--   select c.relname, c.relrowsecurity from pg_class c
--   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
--     and c.relname in ('schools','staff','contacts','events','programs','activities',
--                       'import_batches','district','county','state') order by 1;
--   -- 4. Triggers already on auth.users (so ours doesn't clash). Note the output.
--   select tgname, tgfoid::regproc from pg_trigger
--   where tgrelid = 'auth.users'::regclass and not tgisinternal;
--   -- 5. Foreign keys pointing at auth.users (what can block deleting an account).
--   --    Note the output; 023 adds none.
--   select conrelid::regclass, conname, confdeltype from pg_constraint
--   where confrelid = 'auth.users'::regclass and conrelid::regnamespace::text <> 'auth';
--
-- Reversible: see REVERSE at the bottom (it keeps the log; the log is never dropped).

begin;

-- 0. Snapshot of the policies this changes.
create schema if not exists backup;
create table backup.policies_before_023 as
  select * from pg_policies where schemaname = 'public';

-- 1. Roles.
create table public.user_roles (
  user_id     uuid primary key,
  email       text,
  role        text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  updated_by  text,
  archived    boolean not null default false,
  archived_at timestamptz,
  archived_by text
);

create table public.role_changes (
  change_id        bigint generated always as identity primary key,
  changed_at       timestamptz not null default now(),
  changed_by       uuid,
  changed_by_email text,
  user_id          uuid not null,
  email            text,
  old_role         text,
  new_role         text not null,
  old_archived     boolean,
  new_archived     boolean not null
);
create index role_changes_user_id on public.role_changes (user_id, changed_at desc);

-- 2. The caller's role. security definer: reads user_roles without its policies
--    (which call this), and only ever for auth.uid().
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

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$ select public.app_role() = 'admin'; $fn$;

create or replace function public.can_edit()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$ select public.app_role() in ('admin', 'editor'); $fn$;

-- 3. The rules for changing a role. security definer: the last-admin check reads
--    auth.users, which signed-in users can't.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  from_app boolean := coalesce(current_setting('request.jwt.claims', true), '') <> '';
  old_rank integer := case old.role when 'admin' then 3 when 'editor' then 2 else 1 end;
  new_rank integer := case new.role when 'admin' then 3 when 'editor' then 2 else 1 end;
begin
  new.user_id := old.user_id;
  new.email := old.email;
  new.created_at := old.created_at;

  if from_app then
    if not public.is_admin() then
      raise exception 'Only admins can change roles' using errcode = '42501';
    end if;
    if new.user_id = auth.uid() and new_rank > old_rank then
      raise exception 'You can''t raise your own role' using errcode = '42501';
    end if;
  end if;

  if old.role = 'admin' and not old.archived and (new.role <> 'admin' or new.archived) then
    perform pg_advisory_xact_lock(hashtext('public.user_roles admins'));
    if not exists (
      select 1 from public.user_roles r
      join auth.users u on u.id = r.user_id
      where r.role = 'admin' and not r.archived and r.user_id <> old.user_id
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
    ) then
      raise exception 'There must always be at least one admin: make someone else admin first'
        using errcode = '42501';
    end if;
  end if;

  if new.role is distinct from old.role or new.archived is distinct from old.archived then
    new.updated_at := now();
    new.updated_by := coalesce(auth.jwt() ->> 'email', 'database');
  end if;
  return new;
end;
$fn$;

create trigger guard_role_change before update on public.user_roles
  for each row execute function public.guard_role_change();

-- 4. The log. security definer: signed-in users have no INSERT on role_changes, so the
--    log can only be written here.
create or replace function public.log_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role or new.archived is distinct from old.archived then
    insert into public.role_changes
      (changed_by, changed_by_email, user_id, email, old_role, new_role, old_archived, new_archived)
    values
      (auth.uid(), coalesce(auth.jwt() ->> 'email', 'database'), new.user_id, new.email,
       case when tg_op = 'UPDATE' then old.role end, new.role,
       case when tg_op = 'UPDATE' then old.archived end, new.archived);
  end if;
  return null;
end;
$fn$;

create trigger log_role_change after insert or update on public.user_roles
  for each row execute function public.log_role_change();

create or replace function public.refuse_log_edit()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'role_changes is a log: rows can''t be changed or removed' using errcode = '42501';
end;
$fn$;

create trigger refuse_log_edit before update or delete on public.role_changes
  for each row execute function public.refuse_log_edit();
create trigger refuse_log_truncate before truncate on public.role_changes
  for each statement execute function public.refuse_log_edit();

-- 5. New accounts start as viewers.
create or replace function public.add_viewer_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Never stops an account being created: an existing row is left as it is, and any
  -- error is reported as a warning (the account then has no row and counts as a
  -- viewer; REPAIR below adds the missing rows).
  begin
    insert into public.user_roles (user_id, email, role)
    values (new.id, new.email, 'viewer')
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'add_viewer_role: no role row for % (%): %', new.id, new.email, sqlerrm;
  end;
  return new;
end;
$fn$;

create trigger add_viewer_role after insert on auth.users
  for each row execute function public.add_viewer_role();

-- 6. Every existing account, then the named roles. Stops if a named email is missing.
insert into public.user_roles (user_id, email, role)
select id, email, 'viewer' from auth.users;

do $seed$
declare
  wanted constant jsonb := '{
    "oodedai@siue.edu": "admin", "feranmidyro@gmail.com": "admin", "cgordon@siue.edu": "admin",
    "chbruce@siue.edu": "editor", "sbloodw@siue.edu": "editor"
  }';
  missing text;
begin
  select string_agg(w.key, ', ') into missing
  from jsonb_each_text(wanted) w
  where not exists (select 1 from auth.users u where lower(u.email) = w.key);
  if missing is not null then
    raise exception 'No account for: % (nothing was changed)', missing;
  end if;
  update public.user_roles r set role = w.value
  from jsonb_each_text(wanted) w, auth.users u
  where u.id = r.user_id and lower(u.email) = w.key and w.value <> 'viewer';
  if (select count(*) from public.user_roles where role = 'admin') <> 3 then
    raise exception 'Expected 3 admins after seeding';
  end if;
end
$seed$;

-- 7. Protections on the two new tables.
alter table public.user_roles enable row level security;
create policy "Own row, or all for admins" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- Own row too, so a non-admin's attempt reaches guard_role_change and gets an error
-- instead of silently changing nothing.
create policy "Admins change roles" on public.user_roles
  for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (true);
create policy "Require MFA (aal2)" on public.user_roles
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2') with check ((auth.jwt() ->> 'aal') = 'aal2');
create policy "deny delete" on public.user_roles
  as restrictive for delete to authenticated using (false);
revoke all on public.user_roles from anon, authenticated;
grant select, update on public.user_roles to authenticated;
create trigger guard_bulk_delete after delete on public.user_roles
  referencing old table as deleted for each statement execute function public.guard_bulk_delete();
create trigger stamp_archive before update of archived on public.user_roles
  for each row execute function public.stamp_archive();

alter table public.role_changes enable row level security;
create policy "Admins read the log" on public.role_changes
  for select to authenticated using (public.is_admin());
create policy "Require MFA (aal2)" on public.role_changes
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2') with check ((auth.jwt() ->> 'aal') = 'aal2');
create policy "deny delete" on public.role_changes
  as restrictive for delete to authenticated using (false);
revoke all on public.role_changes from anon, authenticated;
grant select on public.role_changes to authenticated;

-- 8. Editors and admins write; viewers read. On every data table, next to the aal2 rule.
--    USING (true) on update keeps rows visible, so a viewer's update fails the WITH
--    CHECK with an error rather than silently matching nothing.
do $editors$
declare
  t text;
begin
  foreach t in array array['schools', 'staff', 'contacts', 'events', 'programs', 'activities',
                           'import_batches', 'district', 'county', 'state'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Table public.% is missing', t;
    end if;
    execute format('create policy "Editors add" on public.%I as restrictive for insert to authenticated with check (public.can_edit())', t);
    execute format('create policy "Editors change" on public.%I as restrictive for update to authenticated using (true) with check (public.can_edit())', t);
  end loop;
end
$editors$;

-- 9. Functions: callable by signed-in users only.
revoke all on function public.app_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_edit() from public, anon;
grant execute on function public.app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_edit() to authenticated;
-- Trigger functions: nobody calls them directly (Postgres refuses outside a trigger),
-- and Supabase grants execute on new functions by default; take it back.
revoke all on function public.guard_role_change() from public, anon, authenticated;
revoke all on function public.log_role_change() from public, anon, authenticated;
revoke all on function public.refuse_log_edit() from public, anon, authenticated;
revoke all on function public.add_viewer_role() from public, anon, authenticated;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 5, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the roles as set. Expect 3 admin, 2 editor, and every other account viewer.
/*
select role, string_agg(email, ', ' order by email), count(*)
from public.user_roles group by role order by role;
*/

-- TEST 2 — the editor rule is on all ten tables. Expect 10 rows, each with both policies.
/*
select tablename, string_agg(policyname, ', ' order by policyname)
from pg_policies where schemaname = 'public' and policyname in ('Editors add', 'Editors change')
group by 1 order by 1;
*/

-- TEST 3 — grants on the new tables. Expect authenticated: SELECT, UPDATE on user_roles
-- and SELECT on role_changes; nothing for anon.
/*
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('user_roles', 'role_changes')
  and grantee in ('anon', 'authenticated')
group by 1, 2 order by 1, 2;
*/

-- TEST 4 — functions. Expect search_path="" on all; prosecdef true only for app_role,
-- guard_role_change, log_role_change and add_viewer_role; anon can execute none; authenticated only
-- app_role, is_admin and can_edit (the policies call them).
/*
select proname, prosecdef, proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_exec
from pg_proc p
where pronamespace = 'public'::regnamespace
  and proname in ('app_role', 'is_admin', 'can_edit', 'guard_role_change',
                  'log_role_change', 'refuse_log_edit', 'add_viewer_role')
order by 1;
*/

-- TEST 4b — no foreign key from the new tables to auth.users. Expect no rows.
/*
select conrelid::regclass, conname from pg_constraint
where confrelid = 'auth.users'::regclass
  and conrelid in ('public.user_roles'::regclass, 'public.role_changes'::regclass);
*/

-- TEST 5 — the rules, written for the SQL Editor. Select everything from "do $test5$" to
-- the end of the final select and run it. It adds three made-up accounts and their role
-- rows (an admin, an editor, a viewer; none is a real person), tries each rule, and undoes every
-- change: the work happens inside an inner block that always ends by raising an
-- exception, and only the report survives, in a variable. Expect every line to start
-- with PASS.
/*
do $test5$
declare
  report text := '';
  a uuid := '00000000-0000-4000-8000-00000000a001';
  e uuid := '00000000-0000-4000-8000-00000000e001';
  v uuid := '00000000-0000-4000-8000-00000000f001';
  x uuid := '00000000-0000-4000-8000-00000000c001';
  y uuid := '00000000-0000-4000-8000-00000000c002';
  k text;
  n integer;
  r text;
  ok boolean;
  claims text;
begin
  begin
    -- As the owner: the three made-up accounts with their role rows (an admin only
    -- counts towards "at least one admin" while their account exists), and a school to
    -- try writes on.
    insert into public.user_roles (user_id, email, role) values
      (a, 'test5-admin@siue.edu', 'admin'), (e, 'test5-editor@siue.edu', 'editor'),
      (v, 'test5-viewer@siue.edu', 'viewer');
    insert into auth.users (id, email) values
      (a, 'test5-admin@siue.edu'), (e, 'test5-editor@siue.edu'), (v, 'test5-viewer@siue.edu');
    select facility_key into k from public.schools where not archived order by facility_key limit 1;

    -- 1. The owner connection (the scraper, the SQL Editor) is unaffected.
    update public.schools set name = name where facility_key = k;
    get diagnostics n = row_count;
    report := report || case when n = 1 then 'PASS 1 the owner connection (scraper) still writes'
      else 'FAIL 1 the owner updated ' || n || ' rows' end || E'\n';

    -- 1b. A new account gets a viewer row; an existing row is left alone; and a failure
    --     inside the trigger never stops the account being created. (Rolled back like
    --     everything here: no account is kept.)
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000d001', 'test5-signup@siue.edu');
    report := report || case when (select role from public.user_roles where user_id = '00000000-0000-4000-8000-00000000d001') = 'viewer'
      then 'PASS 1b a new account starts as a viewer' else 'FAIL 1b a new account got no viewer row' end || E'\n';
    insert into public.user_roles (user_id, email, role) values ('00000000-0000-4000-8000-00000000d002', 'test5-existing@siue.edu', 'editor');
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000d002', 'test5-existing@siue.edu');
    report := report || case when (select role from public.user_roles where user_id = '00000000-0000-4000-8000-00000000d002') = 'editor'
      then 'PASS 1c an existing role row is left as it is' else 'FAIL 1c the trigger changed an existing role row' end || E'\n';
    -- Make the trigger's insert fail on purpose (a check that only this test's email breaks).
    alter table public.user_roles add constraint test5_force_failure check (email is distinct from 'test5-broken@siue.edu') not valid;
    begin
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000d003', 'test5-broken@siue.edu');
      report := report || case when exists (select 1 from auth.users where id = '00000000-0000-4000-8000-00000000d003')
          and not exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-8000-00000000d003')
        then 'PASS 1d an error in the trigger doesn''t stop the account being created'
        else 'FAIL 1d unexpected state after a failing trigger' end || E'\n';
    exception when others then
      report := report || 'FAIL 1d the trigger''s error stopped the account: ' || sqlerrm || E'\n';
    end;
    alter table public.user_roles drop constraint test5_force_failure;

    set local role authenticated;

    -- The viewer.
    claims := json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test5-viewer@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);
    select count(*) into n from public.schools where facility_key = k;
    report := report || case when n = 1 then 'PASS 2 a viewer can read'
      else 'FAIL 2 a viewer sees ' || n || ' rows' end || E'\n';
    begin
      update public.schools set name = name where facility_key = k;
      report := report || 'FAIL 3 a viewer could update a school' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 3 a viewer''s update is refused: ' || sqlerrm || E'\n';
    end;
    begin
      insert into public.activities (school_id, activity_type, date, description)
      values (k, 'call', current_date, 'TEST 5 viewer');
      report := report || 'FAIL 4 a viewer could add an activity' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 4 a viewer''s insert is refused: ' || sqlerrm || E'\n';
    end;
    begin
      update public.user_roles set role = 'admin' where user_id = v;
      report := report || 'FAIL 5 a viewer promoted themselves' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 5 a viewer can''t promote themselves: ' || sqlerrm || E'\n';
    end;

    -- The editor.
    claims := json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test5-editor@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);
    update public.schools set name = name where facility_key = k;
    get diagnostics n = row_count;
    report := report || case when n = 1 then 'PASS 6 an editor can update a school'
      else 'FAIL 6 an editor updated ' || n || ' rows' end || E'\n';
    begin
      update public.user_roles set role = 'admin' where user_id = e;
      report := report || 'FAIL 7 an editor promoted themselves' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 7 an editor can''t promote themselves: ' || sqlerrm || E'\n';
    end;
    update public.user_roles set role = 'editor' where user_id = v;
    get diagnostics n = row_count;
    select role into r from public.user_roles where user_id = v;
    report := report || case when n = 0 then 'PASS 8 an editor can''t change someone else''s role'
      else 'FAIL 8 an editor changed another account''s role' end || E'\n';

    -- The admin.
    claims := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test5-admin@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);
    update public.user_roles set role = 'editor' where user_id = v;
    select count(*) into n from public.role_changes
    where user_id = v and old_role = 'viewer' and new_role = 'editor'
      and changed_by = a and changed_by_email = 'test5-admin@siue.edu';
    ok := (select role from public.user_roles where user_id = v) = 'editor' and n = 1;
    report := report || case when ok then 'PASS 9 an admin changes a role, and the change is logged (who, whom, old, new, when)'
      else 'FAIL 9 role change or its log entry missing' end || E'\n';
    begin
      update public.role_changes set new_role = 'admin' where user_id = v;
      report := report || 'FAIL 10 the log could be edited' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 10 the log can''t be edited: ' || sqlerrm || E'\n';
    end;
    begin
      delete from public.role_changes where user_id = v;
      report := report || 'FAIL 11 the log could be deleted from' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 11 the log can''t be deleted from: ' || sqlerrm || E'\n';
    end;

    -- The last admin. As the owner, the real admins step down (inside this test only),
    -- leaving the made-up admin as the only one.
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.user_roles set role = 'editor' where role = 'admin' and user_id <> a;
    set local role authenticated;
    perform set_config('request.jwt.claims', claims, true);
    begin
      update public.user_roles set role = 'editor' where user_id = a;
      report := report || 'FAIL 12 the last admin was demoted' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 12 the last admin can''t be demoted: ' || sqlerrm || E'\n';
    end;
    begin
      update public.user_roles set archived = true where user_id = a;
      report := report || 'FAIL 13 the last admin was archived' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 13 the last admin can''t be archived' || E'\n';
    end;
    -- A deleted admin's leftover row doesn't count. As the owner: x becomes admin, then
    -- x's account is deleted (the role row stays: no foreign key).
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into auth.users (id, email) values (x, 'test5-deleted@siue.edu');
    update public.user_roles set role = 'admin' where user_id = x;
    delete from auth.users where id = x;
    set local role authenticated;
    perform set_config('request.jwt.claims', claims, true);
    begin
      update public.user_roles set role = 'editor' where user_id = a;
      report := report || 'FAIL 13b the last admin stepped down: a deleted admin''s row counted' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 13b a deleted admin''s leftover row doesn''t count: the last real admin still can''t step down' || E'\n';
    end;
    -- A banned admin doesn't count either. As the owner: x's row goes back to editor, y
    -- becomes admin, then y's account is banned.
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.user_roles set role = 'editor' where user_id = x;
    insert into auth.users (id, email) values (y, 'test5-banned@siue.edu');
    update public.user_roles set role = 'admin' where user_id = y;
    update auth.users set banned_until = now() + interval '100 years' where id = y;
    set local role authenticated;
    perform set_config('request.jwt.claims', claims, true);
    begin
      update public.user_roles set role = 'editor' where user_id = a;
      report := report || 'FAIL 13c the last admin stepped down: a banned admin counted' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 13c a banned admin doesn''t count: the last real admin still can''t step down' || E'\n';
    end;
    -- With a second admin, stepping down works (the handoff).
    update public.user_roles set role = 'admin' where user_id = e;
    update public.user_roles set role = 'editor' where user_id = a;
    report := report || case when (select role from public.user_roles where user_id = a) = 'editor'
      then 'PASS 14 handoff: once someone else is admin, the old admin can step down'
      else 'FAIL 14 the old admin could not step down' end || E'\n';

    -- Not signed in at all.
    reset role;
    set local role anon;
    begin
      perform 1 from public.user_roles limit 1;
      report := report || 'FAIL 15 anon can read user_roles' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 15 anon can''t read roles' || E'\n';
    end;

    raise exception 'test5: undo everything';
  exception when others then
    if sqlerrm <> 'test5: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test5.report', report, false);
end
$test5$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test5.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test5-%') = 0
             and (select count(*) from public.role_changes where email like 'test5-%') = 0
             and (select count(*) from public.user_roles where role = 'admin' and not archived) = 3
             and (select count(*) from auth.users where email like 'test5-%') = 0
            then 'PASS 16 rolled back: no test rows or test accounts left, and the 3 real admins are unchanged'
            else 'FAIL 16 test rows were left behind or the admins changed' end;
*/

-- TEST 6 — in the app (after the app change that comes with this): as an admin,
-- Settings → Team lists every account; change a viewer to editor and back, and see both
-- changes in the log. Signed in as an account set to viewer, edit buttons are hidden and
-- a forced write shows a permission error.


-- ============================================================================
-- REPAIR (as the owner): give every account without a role row a viewer row
-- ============================================================================
/*
insert into public.user_roles (user_id, email, role)
select id, email, 'viewer' from auth.users
on conflict (user_id) do nothing;
*/


-- ============================================================================
-- REVERSE (keeps user_roles' data in a backup and the log as it is)
-- ============================================================================
/*
begin;
create table backup.user_roles_before_reverse_023 as select * from public.user_roles;
do $$ declare t text; begin
  foreach t in array array['schools','staff','contacts','events','programs','activities',
                           'import_batches','district','county','state'] loop
    execute format('drop policy "Editors add" on public.%I', t);
    execute format('drop policy "Editors change" on public.%I', t);
  end loop;
end $$;
drop trigger add_viewer_role on auth.users;
drop function public.add_viewer_role();
-- user_roles and role_changes stay (the log is never dropped); with the policies gone,
-- they no longer decide anything.
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING outputs here, inside a comment)
-- ============================================================================
--   Applied 2026-10-27. The raw BEFORE APPLYING output wasn't kept here; the results
--   as reported after applying:
--   * TEST 1: 3 admins (cgordon@siue.edu, feranmidyro@gmail.com, oodedai@siue.edu),
--     2 editors (chbruce@siue.edu, sbloodw@siue.edu), every other account viewer.
--   * TEST 2: "Editors add" and "Editors change" on all 10 tables.
--   * TEST 4: guard_role_change is security definer with search_path="", and neither
--     anon nor signed-in users can execute it.
--   * TEST 5: all 21 checks PASS (including 13b and 13c: a deleted or banned admin
--     doesn't count towards "at least one admin").
