-- 024 — Report a problem: bug_reports
--
-- DRAFT, NOT APPLIED. Apply after 023 (roles), which this needs for is_admin(). Review,
-- run the BEFORE APPLYING checks, then apply in the SQL Editor and run the verification.
--
-- Why: the "Report a problem" button on every page saves what went wrong, with the
-- page, the user, the browser, the app version and the time, so an admin can find it
-- in Settings → Problem reports instead of hearing about it second-hand.
--
-- Who reads reports: everyone, viewers included, files reports and sees their own;
-- admins (023) see and manage all of them.
--
-- What it adds:
--   * public.bug_reports: page, description, browser, screen size, app version, who,
--     when, status (open / resolved, with who resolved it and when), archive columns.
--   * stamp_bug_report: on insert, the reporter's id and email come from the sign-in
--     token and the status starts open, whatever the request says, so a report can't
--     be filed as someone else or as already resolved. On a status change it stamps
--     who resolved it and when.
--   * Protections as on every data table: RLS, the restrictive aal2 rule (db/003), a
--     restrictive deny-delete policy (db/010), the bulk-delete guard (db/002), archive
--     stamps (db/009), SELECT/INSERT/UPDATE only for signed-in users and nothing for
--     anon (db/021). On bug_reports, signed-in users may add reports and read their
--     own; only admins read every report and update them (resolve, archive). Not
--     covered by 023's editor rule: viewers file reports too.
--   * reporter_id has no foreign key to auth.users, so deleting a user is never blocked
--     by their reports (see testuser1, M13).
--
-- What does NOT change: no existing table, row or policy. Nothing to snapshot (one new
-- table only); BEFORE APPLYING 1 confirms it doesn't exist yet and that 023 is in.
--
-- BEFORE APPLYING (read-only). Paste the outputs, inside a comment, into "Checked
-- before applying" at the bottom.
--   -- 1. Expect null, then public.is_admin(): no bug_reports yet, and 023 applied.
--   select to_regclass('public.bug_reports'), to_regprocedure('public.is_admin()');
--
-- Reversible: see REVERSE at the bottom.

begin;

-- 1. Reports.
create table public.bug_reports (
  report_id      uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  reporter_id    uuid,
  reporter_email text,
  page           text not null check (length(page) <= 500),
  description    text not null check (length(btrim(description)) between 1 and 5000),
  user_agent     text check (length(user_agent) <= 1000),
  screen         text check (length(screen) <= 50),
  app_version    text check (length(app_version) <= 100),
  status         text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at    timestamptz,
  resolved_by    text,
  archived       boolean not null default false,
  archived_at    timestamptz,
  archived_by    text
);
create index bug_reports_created_at on public.bug_reports (created_at desc);

create or replace function public.stamp_bug_report()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    new.reporter_id := auth.uid();
    new.reporter_email := auth.jwt() ->> 'email';
    new.created_at := now();
    new.status := 'open';
    new.resolved_at := null;
    new.resolved_by := null;
    new.archived := false;
    new.archived_at := null;
    new.archived_by := null;
  else
    -- Who filed it, when and what they wrote never change.
    new.reporter_id := old.reporter_id;
    new.reporter_email := old.reporter_email;
    new.created_at := old.created_at;
    new.page := old.page;
    new.description := old.description;
    if new.status = 'resolved' and old.status <> 'resolved' then
      new.resolved_at := now();
      new.resolved_by := coalesce(auth.jwt() ->> 'email', 'database');
    elsif new.status <> 'resolved' then
      new.resolved_at := null;
      new.resolved_by := null;
    end if;
  end if;
  return new;
end;
$fn$;

create trigger stamp_bug_report before insert or update on public.bug_reports
  for each row execute function public.stamp_bug_report();

alter table public.bug_reports enable row level security;
create policy "Add a report" on public.bug_reports
  for insert to authenticated with check (true);
create policy "Own reports, or all for admins" on public.bug_reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "Admins update" on public.bug_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Require MFA (aal2)" on public.bug_reports
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');
create policy "deny delete" on public.bug_reports
  as restrictive for delete to authenticated using (false);
revoke all on public.bug_reports from anon, authenticated;
grant select, insert, update on public.bug_reports to authenticated;

create trigger guard_bulk_delete after delete on public.bug_reports
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();
create trigger stamp_archive before update of archived on public.bug_reports
  for each row execute function public.stamp_archive();

-- A trigger function: nobody calls it directly; take back Supabase's default execute.
revoke all on function public.stamp_bug_report() from public, anon, authenticated;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 5, which undoes its own changes)
-- ============================================================================

-- TEST 1 — grants. Expect authenticated: INSERT, SELECT, UPDATE; no row for anon.
/*
select grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'bug_reports' and grantee in ('anon', 'authenticated')
group by 1 order by 1;
*/

-- TEST 2 — policies. Expect "Add a report", "Admins update", "Own reports, or all for
-- admins" (permissive), "Require MFA (aal2)" and "deny delete" (restrictive).
/*
select policyname, permissive, cmd from pg_policies
where schemaname = 'public' and tablename = 'bug_reports' order by 1;
*/

-- TEST 3 — triggers. Expect guard_bulk_delete, stamp_archive, stamp_bug_report.
/*
select tgname from pg_trigger
where tgrelid = 'public.bug_reports'::regclass and not tgisinternal order by 1;
*/

-- TEST 4 — stamp_bug_report runs as the caller with a fixed search_path. Expect
-- prosecdef false and {search_path=""}.
/*
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'stamp_bug_report';
*/

-- TEST 5 — the whole cycle, written for the SQL Editor. Select everything from
-- "do $test5$" to the end of the final select and run it. It adds role rows for three
-- made-up accounts (a viewer, another viewer, an admin; none is a real account) and
-- undoes every change: the work happens inside an inner block that always ends by
-- raising an exception, and only the report survives, in a variable. Expect every line
-- to start with PASS.
/*
do $test5$
declare
  report text := '';
  reporter uuid := '00000000-0000-4000-8000-0000000000a1';
  other    uuid := '00000000-0000-4000-8000-0000000000b2';
  boss     uuid := '00000000-0000-4000-8000-0000000000c3';
  mine uuid;
  theirs uuid;
  r public.bug_reports;
  n integer;
  ok boolean;
begin
  begin
    -- As the owner: the made-up accounts' roles.
    insert into public.user_roles (user_id, email, role) values
      (reporter, 'test5-reporter@siue.edu', 'viewer'), (other, 'test5-other@siue.edu', 'viewer'),
      (boss, 'test5-admin@siue.edu', 'admin');

    set local role authenticated;

    -- Another user's report first.
    perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated',
      'aal', 'aal2', 'email', 'test5-other@siue.edu')::text, true);
    insert into public.bug_reports (page, description) values ('/events', 'TEST 5 other report')
      returning report_id into theirs;

    -- A viewer, trying to file as someone else and as already resolved.
    perform set_config('request.jwt.claims', json_build_object('sub', reporter, 'role', 'authenticated',
      'aal', 'aal2', 'email', 'test5-reporter@siue.edu')::text, true);
    insert into public.bug_reports (page, description, user_agent, screen, app_version, reporter_id, reporter_email, status)
    values ('/schools', 'TEST 5 report', 'test browser', '1280x800', 'test', boss, 'someone@else.edu', 'resolved')
    returning * into r;
    mine := r.report_id;
    ok := r.reporter_id = reporter and r.reporter_email = 'test5-reporter@siue.edu' and r.status = 'open';
    report := report || case when ok then 'PASS 1 a viewer files a report as themselves, status open (faked fields ignored)'
      else 'FAIL 1 reporter ' || coalesce(r.reporter_email, 'empty') || ', status ' || r.status end || E'\n';

    select count(*) into n from public.bug_reports where report_id in (mine, theirs);
    report := report || case when n = 1 and exists (select 1 from public.bug_reports where report_id = mine)
      then 'PASS 2 a user sees their own report and not another user''s'
      else 'FAIL 2 the reporter sees ' || n || ' of the two reports' end || E'\n';

    update public.bug_reports set status = 'resolved' where report_id = mine;
    get diagnostics n = row_count;
    report := report || case when n = 0 then 'PASS 3 a non-admin cannot resolve a report'
      else 'FAIL 3 a non-admin updated ' || n || ' report(s)' end || E'\n';

    begin
      delete from public.bug_reports where report_id = mine;
      report := report || 'FAIL 4 a signed-in user could delete a report' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 4 delete refused: ' || sqlerrm || E'\n';
    end;

    -- The admin.
    perform set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated',
      'aal', 'aal2', 'email', 'test5-admin@siue.edu')::text, true);
    select count(*) into n from public.bug_reports where report_id in (mine, theirs);
    report := report || case when n = 2 then 'PASS 5 an admin sees every report'
      else 'FAIL 5 the admin sees ' || n || ' of the two reports' end || E'\n';

    update public.bug_reports set status = 'resolved', description = 'changed' where report_id = mine
      returning * into r;
    ok := r.status = 'resolved' and r.resolved_by = 'test5-admin@siue.edu' and r.resolved_at is not null
      and r.description = 'TEST 5 report';
    report := report || case when ok then 'PASS 6 resolve stamps who and when; the description cannot be changed'
      else 'FAIL 6 resolved_by ' || coalesce(r.resolved_by, 'empty') || ', description ' || r.description end || E'\n';

    update public.bug_reports set archived = true where report_id = mine returning * into r;
    ok := r.archived and r.archived_by = 'test5-admin@siue.edu';
    update public.bug_reports set archived = false where report_id = mine returning * into r;
    ok := ok and not r.archived and r.archived_by is null;
    report := report || case when ok then 'PASS 7 archive stamps who archived it; restore brings it back'
      else 'FAIL 7 archive or restore did not behave' end || E'\n';

    -- Without 2FA: nothing visible, nothing filed.
    perform set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated',
      'aal', 'aal1')::text, true);
    select count(*) into n from public.bug_reports;
    report := report || case when n = 0 then 'PASS 8 an aal1 session sees no reports'
      else 'FAIL 8 an aal1 session sees ' || n || ' reports' end || E'\n';
    begin
      insert into public.bug_reports (page, description) values ('/', 'TEST 5 aal1');
      report := report || 'FAIL 9 an aal1 session could file a report' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 9 an aal1 session cannot file a report' || E'\n';
    end;

    -- Not signed in at all.
    reset role;
    set local role anon;
    begin
      perform 1 from public.bug_reports limit 1;
      report := report || 'FAIL 10 anon can read bug_reports' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 10 anon cannot read reports: ' || sqlerrm || E'\n';
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
select case when (select count(*) from public.bug_reports where description like 'TEST 5%') = 0
             and (select count(*) from public.user_roles where email like 'test5-%') = 0
            then 'PASS 11 rolled back: no test report or role row is left'
            else 'FAIL 11 test rows were left behind' end;
*/

-- TEST 6 — in the app, signed in with 2FA: on any page, Report a problem → write a
-- line → Send; the confirmation shows a reference. As an admin, Settings → Problem
-- reports lists it with the page and browser; Mark resolved, then Archive, then Restore.
-- As a viewer or editor, the same page lists only your own reports.


-- ============================================================================
-- REVERSE (refuses while any report exists; reports are kept, never dropped)
-- ============================================================================
/*
begin;
do $$ begin
  if exists (select 1 from public.bug_reports) then
    raise exception 'Reports exist; keep the table (archive reports instead)';
  end if;
end $$;
drop table public.bug_reports;
drop function public.stamp_bug_report();
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING outputs here, inside a comment)
-- ============================================================================
--   BEFORE APPLYING 1 (2026-10-27): no bug_reports yet, and 023 is in.
--     [
--       {
--         "to_regclass": null,
--         "to_regprocedure": "is_admin()"
--       }
--     ]
--   Applied 2026-10-27, after 023. Verified:
--   * Grants: authenticated has INSERT, SELECT, UPDATE on bug_reports.
--   * Policies: "Add a report", "Admins update", "Own reports, or all for admins",
--     "Require MFA (aal2)", "deny delete".
--   * Triggers guard_bulk_delete, stamp_archive and stamp_bug_report are attached;
--     stamp_bug_report has search_path="".
--   * TEST 5: all 11 checks PASS.
