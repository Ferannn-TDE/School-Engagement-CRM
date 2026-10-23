-- 022 — Bulk activity import: batches, attendee counts, and archive-a-batch
--
-- Applied and verified 2026-10-23 in the SQL Editor. TESTS 1–7 passed (TEST 5 was
-- rewritten as one SQL Editor block after the psql-only version could not run there;
-- all 10 of its checks passed, and TEST 7's save, archive and restore worked in the app).
--
-- Why: Import → Import Activities turns a list of schools (the client's template,
-- e.g. Book10.xlsx) into one activity per school. Every activity saved that way carries
-- the batch it came from, so a wrong upload can be found and archived as a whole, and
-- repeats of a school in the file become one activity with an attendee count (the
-- default until Dr. Gordon answers whether repeats are separate visits).
--
-- What it adds:
--   * public.import_batches: one row per saved upload (file name, SHA-256 of the file,
--     row count, the details applied to every activity, who and when). Same
--     protections as every data table: RLS with a permissive policy for signed-in
--     users, the restrictive aal2 rule (db/003), a restrictive deny-delete policy
--     (db/010), the bulk-delete guard (db/002), archive columns stamped by
--     stamp_archive (db/009), and only SELECT, INSERT and UPDATE granted (db/021).
--   * activities.import_batch_id and activities.attendee_count, both optional, so
--     activities logged by hand are unchanged.
--   * create_import_batch(): saves the batch and its activities in one transaction, so
--     a failure can't leave a batch without its activities or the other way round.
--   * archive_import_batch() / restore_import_batch(): archive or restore a batch and
--     exactly the activities archived with it (same timestamp, as archive_school does),
--     so an activity archived on its own earlier stays archived.
--   All three run as the caller (security invoker): RLS and the aal2 rule apply.
--
-- What does NOT change: no existing row is changed or removed, no column is dropped.
-- activities gets two empty columns. The scraper never touches activities.
--
-- BEFORE APPLYING (read-only). Paste the outputs into "Checked before applying" below.
--   -- 1. activities' columns: event_id must be integer or text, school_id text.
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'activities' order by ordinal_position;
--
--   -- 2. Row count, to compare with the snapshot this migration takes.
--   select count(*) from public.activities;
--
--   -- 3. Nothing is called import_batches yet. Expect no rows.
--   select to_regclass('public.import_batches');
--
-- Snapshot: step 0 copies activities to backup.activities_before_022 before anything
-- else, so the table can be compared or restored exactly as it was.
--
-- Reversible: see REVERSE at the bottom (it keeps every activity; it only removes the
-- two new columns once they are empty, and the batches table once nothing uses it).

begin;

-- 0. Snapshot.
create schema if not exists backup;
create table backup.activities_before_022 as select * from public.activities;

-- 1. The batches table.
create table public.import_batches (
  batch_id       uuid primary key default gen_random_uuid(),
  file_name      text not null,
  file_hash      text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  row_count      integer not null check (row_count >= 0),
  activity_type  text not null,
  activity_date  date not null,
  description    text not null default '',
  event_id       integer,
  created_at     timestamptz not null default now(),
  created_by     text default (auth.jwt() ->> 'email'),
  archived       boolean not null default false,
  archived_at    timestamptz,
  archived_by    text
);
create index import_batches_file_hash on public.import_batches (file_hash);

-- 2. The two columns on activities.
alter table public.activities
  add column import_batch_id uuid references public.import_batches (batch_id),
  add column attendee_count integer check (attendee_count is null or attendee_count >= 1);
create index activities_import_batch_id on public.activities (import_batch_id);

-- 3. Protections, as on every data table.
alter table public.import_batches enable row level security;

create policy "Signed-in users" on public.import_batches
  for all to authenticated using (true) with check (true);
create policy "Require MFA (aal2)" on public.import_batches
  as restrictive for all to authenticated
  using ((auth.jwt() ->> 'aal') = 'aal2')
  with check ((auth.jwt() ->> 'aal') = 'aal2');
create policy "deny delete" on public.import_batches
  as restrictive for delete to authenticated using (false);

revoke all on public.import_batches from anon, authenticated;
grant select, insert, update on public.import_batches to authenticated;

create trigger guard_bulk_delete after delete on public.import_batches
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();
create trigger stamp_archive before update of archived on public.import_batches
  for each row execute function public.stamp_archive();

-- 4. Save a batch and its activities together. p_schools is a JSON array of
--    {"school_id": "...", "attendee_count": n}. Returns the new batch id.
create or replace function public.create_import_batch(
  p_file_name text,
  p_file_hash text,
  p_row_count integer,
  p_activity_type text,
  p_activity_date date,
  p_description text,
  p_event_id integer,
  p_schools jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_batch uuid;
  v_count integer;
begin
  if jsonb_typeof(p_schools) is distinct from 'array' or jsonb_array_length(p_schools) = 0 then
    raise exception 'An import batch needs at least one school';
  end if;
  if jsonb_array_length(p_schools) > 2000 then
    raise exception 'An import batch is limited to 2000 schools';
  end if;

  insert into public.import_batches
    (file_name, file_hash, row_count, activity_type, activity_date, description, event_id)
  values
    (p_file_name, p_file_hash, p_row_count, p_activity_type, p_activity_date,
     coalesce(p_description, ''), p_event_id)
  returning batch_id into v_batch;

  insert into public.activities
    (school_id, activity_type, date, description, event_id, import_batch_id, attendee_count)
  select s.school_id, p_activity_type, p_activity_date, coalesce(p_description, ''),
         p_event_id, v_batch, s.attendee_count
  from jsonb_to_recordset(p_schools) as s(school_id text, attendee_count integer);

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_schools) then
    raise exception 'Expected % activities, saved %', jsonb_array_length(p_schools), v_count;
  end if;
  return v_batch;
end;
$fn$;

-- 5. Archive a batch: the batch and its active activities, all with one timestamp.
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
end;
$fn$;

-- 6. Restore a batch and exactly the activities archived with it.
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
  update public.import_batches set archived = false where batch_id = p_batch_id;
end;
$fn$;

revoke all on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb) from public, anon;
revoke all on function public.archive_import_batch(uuid) from public, anon;
revoke all on function public.restore_import_batch(uuid) from public, anon;
grant execute on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb) to authenticated;
grant execute on function public.archive_import_batch(uuid) to authenticated;
grant execute on function public.restore_import_batch(uuid) to authenticated;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 5, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the snapshot holds every activity. Expect the same number as BEFORE 2.
/*
select (select count(*) from backup.activities_before_022) as snapshot,
       (select count(*) from public.activities) as live;
*/

-- TEST 2 — grants. Expect authenticated: INSERT, SELECT, UPDATE; no row for anon.
/*
select grantee, string_agg(privilege_type, ', ' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'import_batches'
group by grantee order by grantee;
*/

-- TEST 3 — policies and triggers. Expect three policies (the permissive one, the
-- restrictive aal2 one, the restrictive deny delete) and the two triggers.
/*
select policyname, permissive, cmd from pg_policies
where schemaname = 'public' and tablename = 'import_batches' order by policyname;
select tgname from pg_trigger
where tgrelid = 'public.import_batches'::regclass and not tgisinternal order by tgname;
*/

-- TEST 4 — the three functions run as the caller with a fixed search_path.
-- Expect prosecdef false and {search_path=""} for each.
/*
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('create_import_batch', 'archive_import_batch', 'restore_import_batch');
*/

-- TEST 5 — the whole cycle as a signed-in aal2 user. One block for the Supabase SQL
-- Editor (no psql syntax): select everything below, from "do $test5$" to the end of the
-- final select, and run it. It picks two real schools itself, saves a batch, archives
-- and restores it, and checks each step. All of it happens inside an inner block that
-- always ends by raising an exception, so Postgres undoes every change (and the switch
-- to the signed-in role); only the report survives, in a variable. The final select
-- lists one PASS or FAIL per check, and then checks, as the owner, that no test batch
-- was left behind. Expect every line to start with PASS.
/*
do $test5$
declare
  report text := '';
  k1 text;
  k2 text;
  b uuid;
  n integer;
  hand_before integer;
  hand_after integer;
  who text;
  ok boolean;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',
      '{"role":"authenticated","aal":"aal2","email":"test5@siue.edu"}', true);

    select facility_key into k1 from public.schools where not archived order by facility_key limit 1;
    select facility_key into k2 from public.schools where not archived and facility_key > k1 order by facility_key limit 1;
    report := report || case when k1 is not null and k2 is not null
      then 'PASS 1 picked two schools: ' || k1 || ', ' || k2 else 'FAIL 1 could not find two active schools' end || E'\n';

    select count(*) into hand_before from public.activities where import_batch_id is null and not archived;

    -- Save: k1 listed twice in the file (attendee count 2), k2 once.
    b := public.create_import_batch('test5-rollback-check.xlsx', md5('test5') || md5('test5-b'), 3,
      'event_participation', current_date, 'TEST 5, rolled back', null,
      jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 2),
                        jsonb_build_object('school_id', k2, 'attendee_count', 1)));
    select count(*) into n from public.activities where import_batch_id = b;
    select created_by into who from public.import_batches where batch_id = b;
    ok := n = 2
      and exists (select 1 from public.activities where import_batch_id = b and school_id = k1 and attendee_count = 2)
      and exists (select 1 from public.activities where import_batch_id = b and school_id = k2 and attendee_count = 1);
    report := report || case when ok then 'PASS 2 saved a batch with 2 activities (counts 2 and 1)'
      else 'FAIL 2 expected 2 activities with counts 2 and 1, found ' || n end || E'\n';
    report := report || case when who = 'test5@siue.edu' then 'PASS 3 batch records who imported it'
      else 'FAIL 3 created_by is ' || coalesce(who, 'empty') end || E'\n';

    -- k2's activity archived on its own first (an earlier time, as a separate action would have).
    update public.activities set archived = true, archived_at = now() - interval '1 minute'
     where import_batch_id = b and school_id = k2;

    perform public.archive_import_batch(b);
    ok := (select archived from public.import_batches where batch_id = b)
      and not exists (select 1 from public.activities where import_batch_id = b and not archived);
    report := report || case when ok then 'PASS 4 archive: the batch and all its activities are archived'
      else 'FAIL 4 archive left something active' end || E'\n';

    select count(*) into hand_after from public.activities where import_batch_id is null and not archived;
    report := report || case when hand_after = hand_before then 'PASS 5 activities logged by hand untouched (' || hand_after || ')'
      else 'FAIL 5 hand-logged active activities went from ' || hand_before || ' to ' || hand_after end || E'\n';

    perform public.restore_import_batch(b);
    ok := not (select archived from public.import_batches where batch_id = b)
      and exists (select 1 from public.activities where import_batch_id = b and school_id = k1 and not archived)
      and exists (select 1 from public.activities where import_batch_id = b and school_id = k2 and archived);
    report := report || case when ok then 'PASS 6 restore: brings back what the batch archived; the one archived separately stays archived'
      else 'FAIL 6 restore did not bring back exactly the batch''s own archive' end || E'\n';

    -- Deletes are refused with a permission error.
    begin
      delete from public.import_batches where batch_id = b;
      report := report || 'FAIL 7 a signed-in user could delete a batch' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 7 delete refused: ' || sqlerrm || E'\n';
    end;

    -- Without 2FA (aal1) the batch is invisible and nothing can be saved.
    perform set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
    select count(*) into n from public.import_batches;
    report := report || case when n = 0 then 'PASS 8 an aal1 session sees no batches'
      else 'FAIL 8 an aal1 session sees ' || n || ' batches' end || E'\n';
    begin
      perform public.create_import_batch('test5-aal1.xlsx', md5('a') || md5('b'), 1, 'visit', current_date, '', null,
        jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 1)));
      report := report || 'FAIL 9 an aal1 session could save a batch' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 9 an aal1 session cannot save: ' || sqlerrm || E'\n';
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
select case when count(*) = 0 then 'PASS 10 rolled back: no test batch or activity is left'
            else 'FAIL 10 ' || count(*) || ' test rows were left behind' end
from public.import_batches where file_name like 'test5-%';
*/

-- TEST 6 — an aal1 session sees no batches. Expect 0.
/*
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
  select count(*) from public.import_batches;
rollback;
*/

-- TEST 7 — the app, signed in with 2FA: Import → Import Activities. Upload the
-- template with two schools, save, see the batch under Recent imports, archive it
-- (the activities leave the school pages), restore it (they come back).


-- ============================================================================
-- REVERSE (keeps every activity; refuses while any imported activity exists)
-- ============================================================================
/*
begin;
do $$ begin
  if exists (select 1 from public.activities where import_batch_id is not null) then
    raise exception 'Imported activities exist; archive them and keep the columns instead';
  end if;
end $$;
drop function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb);
drop function public.archive_import_batch(uuid);
drop function public.restore_import_batch(uuid);
alter table public.activities drop column attendee_count, drop column import_batch_id;
drop table public.import_batches;
commit;
-- backup.activities_before_022 stays; drop it by hand once no longer wanted.
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING outputs here)
-- ============================================================================
-- Run 2026-10-23 before applying: activities.event_id is integer and school_id is text
-- (as 022 assumes), 2 rows, and no import_batches table yet. Outputs as pasted:
/*
[
  {
    "column_name": "activity_id",
    "data_type": "uuid",
    "is_nullable": "NO"
  },
  {
    "column_name": "school_id",
    "data_type": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "contact_id",
    "data_type": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "event_id",
    "data_type": "integer",
    "is_nullable": "YES"
  },
  {
    "column_name": "activity_type",
    "data_type": "text",
    "is_nullable": "NO"
  },
  {
    "column_name": "date",
    "data_type": "date",
    "is_nullable": "NO"
  },
  {
    "column_name": "description",
    "data_type": "text",
    "is_nullable": "NO"
  },
  {
    "column_name": "outcome",
    "data_type": "text",
    "is_nullable": "YES"
  },
  {
    "column_name": "created_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES"
  },
  {
    "column_name": "archived",
    "data_type": "boolean",
    "is_nullable": "NO"
  },
  {
    "column_name": "archived_at",
    "data_type": "timestamp with time zone",
    "is_nullable": "YES"
  },
  {
    "column_name": "archived_by",
    "data_type": "text",
    "is_nullable": "YES"
  }
]

[
  {
    "count": 2
  }
]

[
  {
    "to_regclass": null
  }
]
*/
