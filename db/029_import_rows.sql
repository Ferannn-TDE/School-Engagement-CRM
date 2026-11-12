-- 029 — Each activity import's rows, with optional visitor names (editors and admins only)
--
-- DRAFT, NOT APPLIED. Run the BEFORE APPLYING checks, apply in the SQL Editor, then run
-- TEST 1–4 and paste the outputs into "Checked before applying" at the bottom.
--
-- Why: Recent imports gets "View rows" (what each row said, which school it matched,
-- its visitor count and an optional name), and the activity details panel lists the
-- visitors' names. Today only one activity per school is saved, with a count; the rows
-- themselves are gone once the file is closed.
--
-- Names are student data. Only editors and admins can read this table (can_edit(),
-- which needs the authenticator step since 025); viewers get no rows at all, and anon
-- has no access. Nothing else returns these rows: no view reads the table, and the
-- functions below return only an id or a count.
--
-- What it adds:
--   * public.import_rows — one row per file row that was saved: batch, row number, the
--     school as typed (name, city, state), the matched school, the activity it fed,
--     visitors (blank = 1) and visitor_name (optional), and the archive columns.
--     Protections as on every data table: RLS, deny delete (010), the bulk-delete guard
--     (002), archive stamps (009), SELECT/INSERT/UPDATE for signed-in users only (021),
--     plus the editors-only rule for reading and writing.
--   * public.create_import_batch(..., p_rows jsonb) — a second form of the 022 function
--     with the rows added: saves the batch, its activities (exactly as 022 does, by
--     calling it) and its rows in one transaction. The 022 form stays, so the app in
--     production keeps working until it's updated.
--   * public.attach_import_rows(p_batch_id, p_file_hash, p_rows) — for a batch saved
--     before 029: adds its rows from the original file, only when the file's SHA-256 is
--     the batch's, and only once. No activity is created or changed. Returns the count.
--   * archive_import_batch / restore_import_batch (022) — now also archive and restore
--     the batch's rows, with the same timestamp.
--
-- Not affected: existing batches and activities (no row changes), RLS on other tables,
-- the scraper (it never touches imports).
--
-- BEFORE APPLYING (read-only):
--   -- 1. Nothing is called import_rows yet, and the 022 functions exist. Expect null,
--   --    then three function names.
--   select to_regclass('public.import_rows');
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('create_import_batch', 'archive_import_batch', 'restore_import_batch')
--   order by 1;
--   -- 2. The key types this table points at. Expect activities.activity_id uuid,
--   --    import_batches.batch_id uuid, schools.facility_key text.
--   select table_name, column_name, data_type from information_schema.columns
--   where table_schema = 'public'
--     and (table_name, column_name) in (('activities', 'activity_id'), ('import_batches', 'batch_id'), ('schools', 'facility_key'));
--   -- 3. Counts, to compare after applying (nothing should change).
--   select (select count(*) from public.import_batches) as batches,
--          (select count(*) from public.activities where import_batch_id is not null) as imported_activities;
--
-- Reversible: see REVERSE at the bottom (it keeps import_rows and its data).

begin;

-- 1. The table.
create table public.import_rows (
  row_id          bigint generated always as identity primary key,
  batch_id        uuid not null references public.import_batches (batch_id),
  row_number      integer not null check (row_number >= 1),
  school_as_typed text not null default '',
  city_as_typed   text not null default '',
  state_as_typed  text not null default '',
  school_id       text references public.schools (facility_key),
  activity_id     uuid references public.activities (activity_id),
  visitors        integer check (visitors is null or visitors >= 1),
  visitor_name    text,
  created_at      timestamptz not null default now(),
  created_by      text default (auth.jwt() ->> 'email'),
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by     text,
  unique (batch_id, row_number)
);
create index import_rows_batch_id on public.import_rows (batch_id);
create index import_rows_activity_id on public.import_rows (activity_id);

-- 2. Protections. Editors and admins only, for reading as well as writing.
alter table public.import_rows enable row level security;

create policy "Editors only" on public.import_rows
  for all to authenticated
  using (public.can_edit())
  with check (public.can_edit());
create policy "deny delete" on public.import_rows
  as restrictive for delete to authenticated using (false);

revoke all on public.import_rows from public, anon, authenticated;
grant select, insert, update on public.import_rows to authenticated;

create trigger guard_bulk_delete after delete on public.import_rows
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();
create trigger stamp_archive before update of archived on public.import_rows
  for each row execute function public.stamp_archive();

-- 3. Inserting rows for a batch (shared by the two functions below). Each row's
--    activity is the batch's activity for its matched school, when there is one.
--    p_rows: [{"row_number": n, "school_as_typed": "...", "city_as_typed": "...",
--              "state_as_typed": "...", "school_id": "..."|null, "visitors": n|null,
--              "visitor_name": "..."|null}, ...]
create or replace function public.insert_import_rows(p_batch_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Import rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'An import is limited to 20000 rows';
  end if;
  insert into public.import_rows
    (batch_id, row_number, school_as_typed, city_as_typed, state_as_typed, school_id,
     activity_id, visitors, visitor_name)
  select p_batch_id, r.row_number, coalesce(r.school_as_typed, ''), coalesce(r.city_as_typed, ''),
         coalesce(r.state_as_typed, ''), r.school_id,
         (select a.activity_id from public.activities a
           where a.import_batch_id = p_batch_id and a.school_id = r.school_id
           order by a.activity_id limit 1),
         r.visitors, nullif(btrim(r.visitor_name), '')
  from jsonb_to_recordset(p_rows) as r(row_number integer, school_as_typed text, city_as_typed text,
                                       state_as_typed text, school_id text, visitors integer, visitor_name text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- 4. Save a batch, its activities and its rows together.
create or replace function public.create_import_batch(
  p_file_name text,
  p_file_hash text,
  p_row_count integer,
  p_activity_type text,
  p_activity_date date,
  p_description text,
  p_event_id integer,
  p_schools jsonb,
  p_rows jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_batch uuid;
begin
  v_batch := public.create_import_batch(p_file_name, p_file_hash, p_row_count, p_activity_type,
                                        p_activity_date, p_description, p_event_id, p_schools);
  perform public.insert_import_rows(v_batch, coalesce(p_rows, '[]'::jsonb));
  return v_batch;
end;
$fn$;

-- 5. Add the rows of a batch saved before 029, from its original file.
create or replace function public.attach_import_rows(p_batch_id uuid, p_file_hash text, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_hash text;
begin
  select file_hash into v_hash from public.import_batches where batch_id = p_batch_id and not archived;
  if not found then
    raise exception 'Import batch % not found or archived', p_batch_id;
  end if;
  if v_hash is distinct from p_file_hash then
    raise exception 'This file is not the one that batch was imported from (its SHA-256 differs)';
  end if;
  -- Only editors can see rows, so this check sees them all.
  if exists (select 1 from public.import_rows where batch_id = p_batch_id) then
    raise exception 'That batch already has its rows';
  end if;
  return public.insert_import_rows(p_batch_id, p_rows);
end;
$fn$;

-- 6. Archive and restore a batch with its activities and its rows (022, extended).
create or replace function public.archive_import_batch(p_batch_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  ts timestamptz := now();
  who text := coalesce(auth.jwt() ->> 'email', 'database');
begin
  update public.import_batches
     set archived = true, archived_at = ts, archived_by = who
   where batch_id = p_batch_id and not archived;
  if not found then
    raise exception 'Import batch % not found or already archived', p_batch_id;
  end if;
  update public.activities
     set archived = true, archived_at = ts, archived_by = who
   where import_batch_id = p_batch_id and not archived;
  update public.import_rows
     set archived = true, archived_at = ts, archived_by = who
   where batch_id = p_batch_id and not archived;
end;
$fn$;

create or replace function public.restore_import_batch(p_batch_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  ts timestamptz;
begin
  select archived_at into ts from public.import_batches
   where batch_id = p_batch_id and archived;
  if not found then
    raise exception 'Import batch % not found or not archived', p_batch_id;
  end if;
  update public.activities
     set archived = false
   where import_batch_id = p_batch_id and archived and archived_at = ts;
  update public.import_rows
     set archived = false
   where batch_id = p_batch_id and archived and archived_at = ts;
  update public.import_batches set archived = false where batch_id = p_batch_id;
end;
$fn$;

revoke all on function public.insert_import_rows(uuid, jsonb) from public, anon;
revoke all on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb) from public, anon;
revoke all on function public.attach_import_rows(uuid, text, jsonb) from public, anon;
grant execute on function public.insert_import_rows(uuid, jsonb) to authenticated;
grant execute on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb) to authenticated;
grant execute on function public.attach_import_rows(uuid, text, jsonb) to authenticated;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 4, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the table, grants and policies. Expect: authenticated has INSERT, SELECT,
-- UPDATE (nothing for anon); policies "Editors only" and "deny delete"; RLS on.
-- select grantee, string_agg(privilege_type, ', ' order by privilege_type)
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'import_rows' group by grantee;
-- select policyname, permissive, cmd, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'import_rows' order by 1;
-- select relrowsecurity from pg_class where oid = 'public.import_rows'::regclass;

-- TEST 2 — nothing returns these rows except the table itself. Expect NO view, and
-- exactly these five functions mentioning import_rows, none returning rows:
-- archive_import_batch (void), attach_import_rows (integer), create_import_batch with
-- 9 arguments (uuid; it calls insert_import_rows), insert_import_rows (integer),
-- restore_import_batch (void). Checked on a throwaway copy on 2026-11-12: exactly these.
-- select table_schema, view_name from information_schema.view_table_usage
-- where table_schema = 'public' and table_name = 'import_rows';
-- select p.oid::regprocedure, pg_get_function_result(p.oid) from pg_proc p
-- where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%import_rows%' order by 1;

-- TEST 3 — nothing existing changed. Expect the same two numbers as BEFORE APPLYING
-- check 3, and 0 rows in import_rows.
-- select (select count(*) from public.import_batches) as batches,
--        (select count(*) from public.activities where import_batch_id is not null) as imported_activities,
--        (select count(*) from public.import_rows) as import_rows;

-- TEST 4 — the rules, written for the SQL Editor. Select everything from "do $test029$"
-- to the end of the final select and run it. It adds two made-up role rows (an editor
-- and a viewer; neither is a real person), saves a test import as the editor, tries
-- every way a viewer could read the rows, archives and restores the batch, and undoes
-- every change: the work happens inside an inner block that always ends by raising an
-- exception, and only the report survives, in a setting. Expect every line to start
-- with PASS.
/*
do $test029$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000029e1';
  v uuid := '00000000-0000-4000-8000-0000000029f1';
  k1 text;
  k2 text;
  b uuid;
  b_old uuid;
  n integer;
  r record;
  ed_claims text;
  vw_claims text;
  hash text := md5('test029') || md5('test029');
  rows_json jsonb;
begin
  begin
    insert into public.user_roles (user_id, email, role) values
      (e, 'test029-editor@siue.edu', 'editor'), (v, 'test029-viewer@siue.edu', 'viewer');
    select facility_key into k1 from public.schools where not archived order by facility_key limit 1;
    select facility_key into k2 from public.schools where not archived order by facility_key offset 1 limit 1;
    rows_json := jsonb_build_array(
      jsonb_build_object('row_number', 2, 'school_as_typed', 'Test High', 'city_as_typed', 'Alton', 'state_as_typed', 'IL', 'school_id', k1, 'visitor_name', 'TEST 029 Student A'),
      jsonb_build_object('row_number', 3, 'school_as_typed', 'Test High', 'city_as_typed', 'Alton', 'state_as_typed', 'IL', 'school_id', k1, 'visitors', 2, 'visitor_name', 'TEST 029 Student B'),
      jsonb_build_object('row_number', 4, 'school_as_typed', 'Other School', 'school_id', k2),
      jsonb_build_object('row_number', 5, 'school_as_typed', 'Not a school', 'school_id', null));
    ed_claims := json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test029-editor@siue.edu')::text;
    vw_claims := json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2', 'email', 'test029-viewer@siue.edu')::text;

    set local role authenticated;

    -- 1. The editor saves an import with its rows; each row is linked to its school's activity.
    perform set_config('request.jwt.claims', ed_claims, true);
    b := public.create_import_batch('test029.xlsx', hash, 4, 'event_participation', current_date, 'TEST 029 import', null,
           jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 3), jsonb_build_object('school_id', k2, 'attendee_count', 1)),
           rows_json);
    select count(*) as total, count(activity_id) as linked, count(visitor_name) as named into r
    from public.import_rows where batch_id = b;
    report := report || case when r.total = 4 and r.linked = 3 and r.named = 2
      then 'PASS 1 the editor saved 4 rows (3 linked to an activity, 2 with a name)'
      else 'FAIL 1 rows ' || r.total || ', linked ' || r.linked || ', named ' || r.named end || E'\n';

    -- 2. A viewer reads 0 rows: directly, filtered by batch, by activity, and by name.
    perform set_config('request.jwt.claims', vw_claims, true);
    select count(*) into n from public.import_rows;
    report := report || case when n = 0 then 'PASS 2 a viewer reads 0 import_rows' else 'FAIL 2 a viewer reads ' || n || ' rows' end || E'\n';
    select count(*) into n from public.import_rows where batch_id = b or visitor_name like 'TEST 029%'
      or activity_id in (select activity_id from public.activities where import_batch_id = b);
    report := report || case when n = 0 then 'PASS 2b a viewer reads 0 rows by batch, name or activity' else 'FAIL 2b a viewer reads ' || n || ' rows' end || E'\n';
    -- …and through every view and function that mentions the table (TEST 2 lists them;
    -- none returns rows). A viewer can't write rows either.
    select count(*) into n from information_schema.view_table_usage where table_schema = 'public' and table_name = 'import_rows';
    report := report || case when n = 0 then 'PASS 2c no view reads import_rows' else 'FAIL 2c ' || n || ' views read import_rows' end || E'\n';
    begin
      perform public.attach_import_rows(b, hash, rows_json);
      report := report || 'FAIL 2d a viewer could attach rows' || E'\n';
    exception when insufficient_privilege or raise_exception then
      report := report || 'PASS 2d a viewer can''t attach rows: ' || sqlerrm || E'\n';
    end;
    begin
      insert into public.import_rows (batch_id, row_number, visitor_name) values (b, 99, 'TEST 029 viewer');
      report := report || 'FAIL 2e a viewer could insert a row' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 2e a viewer''s insert is refused' || E'\n';
    end;
    update public.import_rows set visitor_name = 'TEST 029 changed' where batch_id = b;
    get diagnostics n = row_count;
    report := report || case when n = 0 then 'PASS 2f a viewer''s update changes nothing' else 'FAIL 2f a viewer changed ' || n || ' rows' end || E'\n';

    -- 3. An editor whose sign-in is password-only (aal1) is a viewer too (025): 0 rows.
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal1', 'email', 'test029-editor@siue.edu')::text, true);
    select count(*) into n from public.import_rows;
    report := report || case when n = 0 then 'PASS 3 an editor at aal1 reads 0 rows' else 'FAIL 3 an editor at aal1 reads ' || n || ' rows' end || E'\n';

    -- 4. Archiving the batch archives its rows (same time); restoring brings them back.
    perform set_config('request.jwt.claims', ed_claims, true);
    perform public.archive_import_batch(b);
    select count(*) filter (where archived) as arch, count(distinct archived_at) as times into r from public.import_rows where batch_id = b;
    report := report || case when r.arch = 4 and r.times = 1
      then 'PASS 4 archiving the batch archived its 4 rows, with one timestamp'
      else 'FAIL 4 archived ' || r.arch || ' rows' end || E'\n';
    perform public.restore_import_batch(b);
    select count(*) filter (where not archived) into n from public.import_rows where batch_id = b;
    report := report || case when n = 4 then 'PASS 4b restoring brought the 4 rows back' else 'FAIL 4b ' || n || ' rows restored' end || E'\n';

    -- 5. Old batches: rows can be added once, only from the same file.
    b_old := public.create_import_batch('test029-old.xlsx', hash, 2, 'visit', current_date, 'TEST 029 old', null,
               jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 2)));
    begin
      perform public.attach_import_rows(b_old, md5('other') || md5('other'), rows_json);
      report := report || 'FAIL 5 a different file was accepted' || E'\n';
    exception when raise_exception then
      report := report || 'PASS 5 a different file is refused' || E'\n';
    end;
    n := public.attach_import_rows(b_old, hash, rows_json);
    report := report || case when n = 4 then 'PASS 5b the same file adds its 4 rows' else 'FAIL 5b added ' || n end || E'\n';
    begin
      perform public.attach_import_rows(b_old, hash, rows_json);
      report := report || 'FAIL 5c rows were added twice' || E'\n';
    exception when raise_exception then
      report := report || 'PASS 5c rows can''t be added twice' || E'\n';
    end;
    select count(*) into n from public.activities where import_batch_id = b_old;
    report := report || case when n = 1 then 'PASS 5d adding rows created no activity' else 'FAIL 5d ' || n || ' activities' end || E'\n';

    raise exception 'test029: undo everything';
  exception when others then
    if sqlerrm <> 'test029: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test029.report', report, false);
end
$test029$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test029.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test029-%') = 0
             and (select count(*) from public.import_batches where file_name like 'test029%') = 0
             and (select count(*) from public.import_rows) = 0
            then 'PASS 6 rolled back: no test rows left'
            else 'FAIL 6 test rows were left behind' end;
*/


-- ============================================================================
-- REVERSE (keeps import_rows and its data; puts the 022 archive functions back)
-- ============================================================================
/*
begin;
drop function if exists public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb);
drop function if exists public.attach_import_rows(uuid, text, jsonb);
drop function if exists public.insert_import_rows(uuid, jsonb);
-- Then run sections 5 and 6 of db/022 again for archive_import_batch / restore_import_batch.
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   Applied 2026-11-12 in the SQL Editor. Results as reported:
--   * BEFORE APPLYING 1: the three 022 functions.
--   * BEFORE APPLYING 2: uuid, uuid, text.
--   * BEFORE APPLYING 3: batches 3, imported activities 66.
--   * Migration: success.
--   * TEST 1: RLS on; policies "Editors only" (permissive, ALL) and "deny delete"
--     (restrictive, DELETE); grants: authenticated INSERT, SELECT, UPDATE; nothing for
--     anon; postgres and service_role full (owner and admin).
--   * TEST 2: no views; the five functions (void, void, integer, uuid, integer).
--   * TEST 3: 3 / 66 / 0.
--   * TEST 4: all 15 PASS.
--   * import_rows is not in the supabase_realtime publication.
--   Before applying, TEST 4 also passed on a throwaway copy; with the table opened to
--   everyone on purpose, the viewer checks (2, 2b, 2e, 2f, 3) failed as they should.
