-- 031 — An event's participating schools, in their own table
--
-- APPLIED 2026-11-19 (results under "Checked before applying" at the bottom).
--
-- Why: Create Event fails for any event with two or more schools. The form saved them
-- as a comma-joined list in events.schools_involved, but that column has a foreign key
-- to schools (events_schools_involved_fkey), so it can hold only one school key. The
-- school-calendar scraper uses it for the host school (171 events, never more than one),
-- and no event has ever been saved with participating schools. Error seen on 2026-11-19:
--   23503 insert or update on table "events" violates foreign key constraint
--   "events_schools_involved_fkey" — Key is not present in table "schools".
--
-- What it adds:
--   * public.event_schools — one row per event and school: event, school, who added it
--     and when, and the archive columns. Unique per (event, school). Protections as on
--     every data table since 025: RLS, signed-in users read, editors and admins write
--     (023 "Editors add" / "Editors change"), deny delete (010), the bulk-delete guard
--     (002), archive stamps (009), SELECT/INSERT/UPDATE for signed-in users only (021).
--   * public.set_event_schools(p_event_id, p_school_ids) — makes the event's live list
--     exactly p_school_ids in one transaction: adds the new ones, restores ones archived
--     earlier, archives the ones no longer listed. Nothing is deleted. Refuses an archived
--     or missing event, an archived or missing school, and more than 2000 schools.
--     Returns the live count, and checks it equals the number of distinct schools given.
--
-- Not affected: events.schools_involved and its foreign key (the scraper's host school;
-- the app stops writing it but still reads it), the county views that read it, existing
-- events, the scraper. Additive only: the app on main keeps working unchanged.
--
-- BEFORE APPLYING (read-only):
--   -- 1. Nothing called event_schools yet. Expect null.
--   select to_regclass('public.event_schools');
--   -- 2. The key types. Expect events.event_id integer, schools.facility_key text.
--   select table_name, column_name, data_type from information_schema.columns
--   where table_schema = 'public'
--     and (table_name, column_name) in (('events', 'event_id'), ('schools', 'facility_key'));
--   -- 3. Counts to compare after (nothing should change). Expect multi_school 0.
--   select (select count(*) from public.events) as events,
--          (select count(*) from public.events where schools_involved is not null) as with_host,
--          (select count(*) from public.events where schools_involved like '%,%') as multi_school;
--
-- Reversible: see REVERSE at the bottom (it keeps the table and its rows).

begin;

-- 1. The table.
create table public.event_schools (
  event_school_id bigint generated always as identity primary key,
  event_id        integer not null references public.events (event_id),
  school_id       text not null references public.schools (facility_key),
  created_at      timestamptz not null default now(),
  created_by      text default (auth.jwt() ->> 'email'),
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  unique (event_id, school_id)
);
create index event_schools_school_id on public.event_schools (school_id);

-- 2. Protections, as on every data table.
alter table public.event_schools enable row level security;

create policy "Signed-in users" on public.event_schools
  for all to authenticated using (true) with check (true);
create policy "Editors add" on public.event_schools
  as restrictive for insert to authenticated with check (public.can_edit());
create policy "Editors change" on public.event_schools
  as restrictive for update to authenticated using (true) with check (public.can_edit());
create policy "deny delete" on public.event_schools
  as restrictive for delete to authenticated using (false);

revoke all on public.event_schools from public, anon, authenticated;
grant select, insert, update on public.event_schools to authenticated;

create trigger guard_bulk_delete after delete on public.event_schools
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();
create trigger stamp_archive before update of archived on public.event_schools
  for each row execute function public.stamp_archive();

-- 3. Set an event's schools.
create or replace function public.set_event_schools(p_event_id integer, p_school_ids text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ids text[] := array(select distinct btrim(x) from unnest(coalesce(p_school_ids, '{}')) as x where btrim(x) <> '');
  v_bad text;
  v_live integer;
begin
  if not exists (select 1 from public.events where event_id = p_event_id and not archived) then
    raise exception 'That event is archived or no longer exists';
  end if;
  if cardinality(v_ids) > 2000 then
    raise exception 'An event can list at most 2000 schools';
  end if;
  select x into v_bad from unnest(v_ids) as x
   where not exists (select 1 from public.schools s where s.facility_key = x and not s.archived)
   limit 1;
  if v_bad is not null then
    raise exception 'One of the schools is archived or no longer in the directory (%)', v_bad;
  end if;

  -- Archive the ones no longer listed.
  update public.event_schools set archived = true
   where event_id = p_event_id and not archived and school_id <> all (v_ids);
  -- Restore the ones listed again.
  update public.event_schools set archived = false
   where event_id = p_event_id and archived and school_id = any (v_ids);
  -- Add the new ones.
  insert into public.event_schools (event_id, school_id)
  select p_event_id, x from unnest(v_ids) as x
  on conflict (event_id, school_id) do nothing;

  select count(*) into v_live from public.event_schools where event_id = p_event_id and not archived;
  if v_live <> cardinality(v_ids) then
    raise exception 'Expected % schools on the event, found %', cardinality(v_ids), v_live;
  end if;
  return v_live;
end;
$fn$;

revoke all on function public.set_event_schools(integer, text[]) from public, anon;
grant execute on function public.set_event_schools(integer, text[]) to authenticated;

commit;

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- TEST 1 — grants and policies. Expect: authenticated INSERT, SELECT, UPDATE (nothing for
-- anon); policies "Signed-in users", "Editors add", "Editors change", "deny delete"; RLS on.
-- select grantee, string_agg(privilege_type, ', ' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'event_schools' group by grantee;
-- select policyname, permissive, cmd from pg_policies
-- where schemaname = 'public' and tablename = 'event_schools' order by 1;
-- select relrowsecurity from pg_class where oid = 'public.event_schools'::regclass;

-- TEST 2 — nothing existing changed. Expect the same three numbers as BEFORE APPLYING 3,
-- and 0 rows in event_schools.
-- select (select count(*) from public.events) as events,
--        (select count(*) from public.events where schools_involved is not null) as with_host,
--        (select count(*) from public.events where schools_involved like '%,%') as multi_school,
--        (select count(*) from public.event_schools) as event_schools;

-- TEST 3 — the rules, for the SQL Editor. Select from "do $test031$" to the end of the
-- final select and run it. It adds two made-up role rows (an editor and a viewer), a test
-- event, and works through set_event_schools as each; the inner block always ends by
-- raising an exception, so every change is undone and only the report survives. Expect
-- every line to start with PASS.
/*
do $test031$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000031e1';
  v uuid := '00000000-0000-4000-8000-0000000031f1';
  ids text[];
  ev integer;
  n integer;
  r record;
begin
  begin
    insert into public.user_roles (user_id, email, role) values
      (e, 'test031-editor@siue.edu', 'editor'), (v, 'test031-viewer@siue.edu', 'viewer');
    select array_agg(facility_key) into ids from (
      select facility_key from public.schools where not archived order by facility_key limit 15) s;

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test031-editor@siue.edu')::text, true);

    -- 1. The case that failed: Other, 15 schools.
    insert into public.events (fair_name, date, is_scraped, event_type, event_type_other, attendance)
    values ('TEST 031 event', current_date, false, 'other', 'Alumni panel', 15) returning event_id into ev;
    n := public.set_event_schools(ev, ids);
    report := report || case when n = 15 then 'PASS 1 an Other event saved with 15 schools' else 'FAIL 1 ' || n end || E'\n';

    -- 2. Down to 10: 5 archived, not deleted; back to 15: restored, no duplicates.
    n := public.set_event_schools(ev, ids[1:10]);
    select count(*) filter (where archived) as arch, count(*) as total into r from public.event_schools where event_id = ev;
    report := report || case when n = 10 and r.arch = 5 and r.total = 15 then 'PASS 2 removing 5 archived them (15 rows kept)' else 'FAIL 2 live ' || n || ' archived ' || r.arch || ' total ' || r.total end || E'\n';
    n := public.set_event_schools(ev, ids || ids[1:3]);
    select count(*) as total into r from public.event_schools where event_id = ev;
    report := report || case when n = 15 and r.total = 15 then 'PASS 2b re-adding restored them; duplicates ignored' else 'FAIL 2b live ' || n || ' total ' || r.total end || E'\n';

    -- 3. A school that isn't in the directory is refused with a plain message.
    begin
      perform public.set_event_schools(ev, array['NOT-A-SCHOOL']);
      report := report || 'FAIL 3 an unknown school was accepted' || E'\n';
    exception when raise_exception then
      report := report || 'PASS 3 unknown school refused: ' || sqlerrm || E'\n';
    end;

    -- 4. A viewer can read but not change the list.
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal1', 'email', 'test031-viewer@siue.edu')::text, true);
    select count(*) into n from public.event_schools where event_id = ev and not archived;
    report := report || case when n = 15 then 'PASS 4 a viewer reads the 15 schools' else 'FAIL 4 a viewer reads ' || n end || E'\n';
    begin
      perform public.set_event_schools(ev, ids[1:2]);
      report := report || 'FAIL 4b a viewer changed the list' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 4b a viewer can''t change the list' || E'\n';
    end;

    -- 5. Nobody can delete a row: DELETE isn't granted (and "deny delete" backs it up).
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test031-editor@siue.edu')::text, true);
    begin
      delete from public.event_schools where event_id = ev;
      get diagnostics n = row_count;
      report := report || case when n = 0 then 'PASS 5 delete removes nothing' else 'FAIL 5 deleted ' || n end || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 5 an editor''s delete is refused' || E'\n';
    end;

    raise exception 'test031: undo everything';
  exception when others then
    if sqlerrm <> 'test031: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test031.report', report, false);
end
$test031$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test031.report'), E'\n'), E'\n') as line
union all
select case when (select count(*) from public.user_roles where email like 'test031-%') = 0
             and (select count(*) from public.events where fair_name = 'TEST 031 event') = 0
             and (select count(*) from public.event_schools) = 0
            then 'PASS 6 rolled back: no test rows left'
            else 'FAIL 6 test rows were left behind' end;
*/


-- ============================================================================
-- REVERSE (keeps event_schools and its rows; the app then lists only host schools)
-- ============================================================================
/*
begin;
drop function if exists public.set_event_schools(integer, text[]);
commit;
notify pgrst, 'reload schema';
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   2026-11-19, on a throwaway local Postgres with a stub of the tables, roles,
--   auth.jwt(), can_edit() (025 rules), guard_bulk_delete and stamp_archive:
--   * The stub reproduces the production error for a comma list in schools_involved.
--   * Migration: success. Policies: Editors add, Editors change, Signed-in users, deny delete.
--   * TEST 3: all 8 PASS (5: DELETE isn't granted, so it's refused outright).
--
--   Applied 2026-11-19 in the SQL Editor. Results as reported:
--   * BEFORE APPLYING 1: null.
--   * BEFORE APPLYING 2: events.event_id integer, schools.facility_key text.
--   * BEFORE APPLYING 3: 255 events, 171 with a host school, multi_school 0.
--   * Migration: success.
--   * TEST 1: RLS on. Policies "Signed-in users" (permissive, ALL), "Editors add"
--     (restrictive, INSERT), "Editors change" (restrictive, UPDATE), "deny delete"
--     (restrictive, DELETE). Grants: authenticated INSERT, SELECT, UPDATE; nothing for
--     anon; postgres and service_role full (owner and admin).
--   * TEST 2: events 255, with_host 171, multi_school 0, event_schools 0.
--   * TEST 3: all 8 PASS (1, 2, 2b, 3, 4, 4b, 5, 6).
