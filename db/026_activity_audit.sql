-- 026 — Who logged an activity, and who last edited it
--
-- DRAFT, NOT APPLIED. Run the BEFORE APPLYING checks, apply in the SQL Editor, then run
-- TEST 1–3 and paste the outputs into "Checked before applying" at the bottom.
--
-- Why: the visit details panel on a school's Activity History shows who logged an
-- activity and who last edited it, and when. The activities table has no such columns:
-- only archived_at / archived_by (009).
--
-- What it adds, on public.activities only:
--   * created_by  text         — the signed-in user's email when the row was added
--                                ('database' for the owner connection: SQL Editor, scraper).
--   * updated_at  timestamptz  — when the row's content was last changed.
--   * updated_by  text         — who changed it.
--   * stamp_activity_insert (before insert) — sets created_by from the sign-in, whatever
--     the request sent, and clears updated_at / updated_by. create_import_batch (022) runs
--     as the caller, so imported activities get the importer's email too.
--   * stamp_activity_update (before update) — keeps created_by as it was, and stamps
--     updated_at / updated_by only when the content changes (school, contact, event,
--     type, date, description, outcome, visitor count). Archiving or restoring is not an
--     edit: 009 stamps archived_at / archived_by for that, and updated_* stay as they were.
--
-- Existing rows: nothing is changed or backfilled. Their created_by, updated_at and
-- updated_by stay null; the app shows "Not recorded" (and, for imported rows, the
-- import batch's created_by from 022). No data is deleted.
--
-- Not affected: RLS, the editor rule (023), aal2 (003), deny-delete (010), grants (021).
-- Signed-in users already have UPDATE on activities; the triggers overwrite anything they
-- send in the three new columns, so they can't be spoofed.
--
-- Activity dates: no rule on activities.date is added here. The app will allow dates up
-- to one year ahead. BEFORE APPLYING check 2 confirms the live table has no constraint or
-- trigger that refuses a future date (none is in db/001–024).
--
-- BEFORE APPLYING (read-only):
--   -- 1. The three columns don't exist yet. Expect no rows.
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'activities'
--     and column_name in ('created_by', 'updated_at', 'updated_by');
--   -- 2. Constraints and triggers on activities. Expect no CHECK that mentions "date",
--   --    and only stamp_archive, guard_bulk_delete and their kin among the triggers.
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.activities'::regclass order by 1;
--   select tgname, tgfoid::regproc from pg_trigger
--   where tgrelid = 'public.activities'::regclass and not tgisinternal order by 1;
--   -- 3. Row count, to compare after applying (nothing should change).
--   select count(*) as activities, count(*) filter (where archived) as archived
--   from public.activities;
--
-- Reversible: see REVERSE at the bottom (it keeps the columns and what's in them).

begin;

alter table public.activities
  add column if not exists created_by text,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by text;

create or replace function public.stamp_activity_insert()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.created_by := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'database'
  );
  new.updated_at := null;
  new.updated_by := null;
  return new;
end;
$fn$;

create or replace function public.stamp_activity_update()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.created_by := old.created_by;
  if (new.school_id, new.contact_id, new.event_id, new.activity_type, new.date,
      new.description, new.outcome, new.attendee_count)
     is distinct from
     (old.school_id, old.contact_id, old.event_id, old.activity_type, old.date,
      old.description, old.outcome, old.attendee_count) then
    new.updated_at := now();
    new.updated_by := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
      'database'
    );
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$fn$;

drop trigger if exists stamp_activity_insert on public.activities;
create trigger stamp_activity_insert before insert on public.activities
  for each row execute function public.stamp_activity_insert();

drop trigger if exists stamp_activity_update on public.activities;
create trigger stamp_activity_update before update on public.activities
  for each row execute function public.stamp_activity_update();

revoke all on function public.stamp_activity_insert() from public, anon;
revoke all on function public.stamp_activity_update() from public, anon;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 3, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the columns. Expect 3 rows: created_by text, updated_at timestamp with time
-- zone, updated_by text.
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'activities'
--   and column_name in ('created_by', 'updated_at', 'updated_by') order by 1;

-- TEST 2 — nothing existing changed. Expect the same two numbers as BEFORE APPLYING
-- check 3, and 0 rows with any of the new columns filled.
-- select count(*) as activities, count(*) filter (where archived) as archived,
--        count(*) filter (where created_by is not null or updated_at is not null
--                         or updated_by is not null) as stamped
-- from public.activities;

-- TEST 3 — the rules, written for the SQL Editor. Select everything from "do $test026$"
-- to the end of the final select and run it. It adds two made-up role rows (an editor and
-- a viewer; neither is a real person), tries each rule, and undoes every change: the work
-- happens inside an inner block that always ends by raising an exception, and only the
-- report survives, in a setting. Expect every line to start with PASS.
/*
do $test026$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000025e1';
  v uuid := '00000000-0000-4000-8000-0000000025f1';
  k text;
  id_app uuid;
  id_owner uuid;
  b uuid;
  r record;
  claims text;
begin
  begin
    -- As the owner: two made-up role rows and a school to write on.
    insert into public.user_roles (user_id, email, role) values
      (e, 'test026-editor@siue.edu', 'editor'), (v, 'test026-viewer@siue.edu', 'viewer');
    select facility_key into k from public.schools where not archived order by facility_key limit 1;

    -- 1. The owner connection (SQL Editor, scraper) is stamped 'database'.
    insert into public.activities (school_id, activity_type, date, description)
    values (k, 'call', current_date, 'TEST 026 owner') returning activity_id into id_owner;
    select created_by, updated_at into r from public.activities where activity_id = id_owner;
    report := report || case when r.created_by = 'database' and r.updated_at is null
      then 'PASS 1 the owner''s insert is stamped database'
      else 'FAIL 1 owner insert stamped ' || coalesce(r.created_by, 'null') end || E'\n';

    set local role authenticated;
    claims := json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                'email', 'test026-editor@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);

    -- 2. An editor's insert records their email, even if the request sends another.
    insert into public.activities (school_id, activity_type, date, description, created_by, updated_by, updated_at)
    values (k, 'visit', current_date, 'TEST 026 editor', 'someone-else@siue.edu', 'x', now())
    returning activity_id into id_app;
    select created_by, updated_at, updated_by into r from public.activities where activity_id = id_app;
    report := report || case when r.created_by = 'test026-editor@siue.edu' and r.updated_at is null and r.updated_by is null
      then 'PASS 2 insert records the signed-in email and ignores sent values'
      else 'FAIL 2 insert stamped ' || coalesce(r.created_by, 'null') end || E'\n';

    -- 3. A future date (364 days ahead) is accepted by the database. Its own row, so
    --    id_app stays unedited for TEST 4.
    begin
      insert into public.activities (school_id, activity_type, date, description)
      values (k, 'visit', current_date + 364, 'TEST 026 future');
      report := report || 'PASS 3 a date 364 days ahead is accepted' || E'\n';
    exception when others then
      report := report || 'FAIL 3 a future date was refused: ' || sqlerrm || E'\n';
    end;

    -- 4. A content edit stamps updated_at / updated_by; created_by can't be changed.
    --    First: nothing has edited id_app yet, so both are still null.
    select updated_at, updated_by into r from public.activities where activity_id = id_app;
    report := report || case when r.updated_at is null and r.updated_by is null
      then 'PASS 4a before any edit, updated_at and updated_by are null'
      else 'FAIL 4a id_app was already stamped before the edit' end || E'\n';
    update public.activities
       set description = 'TEST 026 edited', attendee_count = 4, created_by = 'someone-else@siue.edu'
     where activity_id = id_app;
    select created_by, updated_at, updated_by, attendee_count into r from public.activities where activity_id = id_app;
    report := report || case when r.created_by = 'test026-editor@siue.edu' and r.updated_at is not null
        and r.updated_by = 'test026-editor@siue.edu' and r.attendee_count = 4
      then 'PASS 4 an edit stamps who and when, and created_by stays'
      else 'FAIL 4 after edit: created_by ' || coalesce(r.created_by, 'null') || ', updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 5. Archiving is not an edit: updated_* stay; archived_by is stamped (009).
    update public.activities set updated_at = null, updated_by = null where activity_id = id_app;  -- must be ignored too
    update public.activities set archived = true where activity_id = id_app;
    select updated_at, updated_by, archived_by into r from public.activities where activity_id = id_app;
    report := report || case when r.updated_at is not null and r.updated_by = 'test026-editor@siue.edu'
        and r.archived_by = 'test026-editor@siue.edu'
      then 'PASS 5 archiving leaves the last edit as it was and stamps archived_by'
      else 'FAIL 5 after archive: updated_by ' || coalesce(r.updated_by, 'null') || ', archived_by ' || coalesce(r.archived_by, 'null') end || E'\n';

    -- 6. An import batch (022) stamps the importer on its activities.
    b := public.create_import_batch('test026.xlsx', md5('test026') || md5('test026'), 1,
      'event_participation', current_date, 'TEST 026 import', null,
      jsonb_build_array(jsonb_build_object('school_id', k, 'attendee_count', 3)));
    report := report || case when exists (select 1 from public.activities
        where import_batch_id = b and created_by = 'test026-editor@siue.edu' and attendee_count = 3)
      then 'PASS 6 imported activities record the importer'
      else 'FAIL 6 imported activity not stamped' end || E'\n';

    -- 7. A viewer still can't change an activity (023).
    claims := json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2',
                                'email', 'test026-viewer@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);
    begin
      update public.activities set description = 'TEST 026 viewer' where activity_id = id_owner;
      if found then
        report := report || 'FAIL 7 a viewer changed an activity' || E'\n';
      else
        report := report || 'PASS 7 a viewer''s update changes nothing' || E'\n';
      end if;
    exception when insufficient_privilege then
      report := report || 'PASS 7 a viewer''s update is refused: ' || sqlerrm || E'\n';
    end;
    report := report || case when (select description from public.activities where activity_id = id_owner) = 'TEST 026 owner'
      then 'PASS 7b the owner''s row is unchanged after the viewer''s attempt'
      else 'FAIL 7b the viewer changed the owner''s row' end || E'\n';

    raise exception 'test026: undo everything';
  exception when others then
    if sqlerrm <> 'test026: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test026.report', report, false);
end
$test026$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test026.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test026-%') = 0
             and (select count(*) from public.activities where description like 'TEST 026%') = 0
             and (select count(*) from public.import_batches where file_name = 'test026.xlsx') = 0
            then 'PASS 8 rolled back: no test rows left'
            else 'FAIL 8 test rows were left behind' end;
*/


-- ============================================================================
-- REVERSE (stops the stamping; keeps the columns and what's in them)
-- ============================================================================
/*
begin;
drop trigger if exists stamp_activity_insert on public.activities;
drop trigger if exists stamp_activity_update on public.activities;
drop function if exists public.stamp_activity_insert();
drop function if exists public.stamp_activity_update();
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   Applied before 2026-11-11 21:23 UTC (the columns exist in the live table).
--   The SQL Editor outputs (BEFORE APPLYING 1–3, TEST 1–3) haven't been pasted here yet.
--   Seen from the app on 2026-11-11 (read-only queries, signed in as an admin at aal2):
--     * created_by, updated_at and updated_by exist on public.activities.
--     * Two activities logged from the app at 21:23 UTC (later archived) have
--       created_by = 'oodedai@siue.edu': the insert trigger stamps the signed-in email.
--     * Archiving both left updated_at / updated_by null: archiving is not an edit.
--     * Every other activity still has created_by null: nothing was backfilled.
