-- 030 — Activity imports can be "Other" with their "Please specify" text
--
-- DRAFT, NOT APPLIED. Run BEFORE APPLYING (including TEST A, which works on the old
-- functions too), apply in the SQL Editor, then run TEST 1, TEST A again and TEST B, and
-- paste the outputs into "Checked before applying" at the bottom.
--
-- Why: Import Activities is getting "Other" with a required "Please specify" box (as Log
-- contact has since 028). The import functions can't save that text: 022's
-- create_import_batch (and 029's form, which calls it) insert activities without
-- activity_type_other, and 028's require_other_text refuses "other" without its text.
--
-- What it changes:
--   * import_batches.activity_type_other (optional text), with the same 028 trigger
--     (require_other_text): "other" needs its text, checked only when the type or the
--     text is being set.
--   * create_import_batch: the two forms (022's 8 arguments, 029's 9) are replaced by ONE
--     function with the same 8 arguments plus two optional ones: p_rows (as in 029) and
--     p_activity_type_other. One function answers every call the app makes (8, 9 or 10
--     arguments by name, or 8 or 9 by position); keeping three forms side by side would
--     make an 8-argument call ambiguous. It does exactly what 022 did, in the same order
--     and with the same messages (at least one school, at most 2000, the saved count must
--     match), then saves the rows as 029 did (insert_import_rows, unchanged). The text is
--     stored on the batch and on every activity, only when the type is "other".
--     TEST A shows the old and the new give the same results for the same input.
--   * Grants re-applied after recreating: nothing for public or anon, execute for
--     authenticated. Still security invoker: RLS and can_edit() apply as before.
--   * Ends with NOTIFY pgrst so the API sees the new function at once.
--
-- Not affected: existing batches, activities and rows (nothing changes or is removed;
-- only the function is dropped and recreated, in one transaction); archive_import_batch,
-- restore_import_batch, attach_import_rows, insert_import_rows; the app on main, whose
-- 9-argument call resolves to the new function.
--
-- BEFORE APPLYING (read-only, except TEST A, which undoes its own changes):
--   -- 1. The two current forms. Expect exactly:
--   --    create_import_batch(text,text,integer,text,date,text,integer,jsonb)
--   --    create_import_batch(text,text,integer,text,date,text,integer,jsonb,jsonb)
--   select p.oid::regprocedure from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'create_import_batch' order by 1;
--   -- 2. The new column doesn't exist yet. Expect no rows.
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'import_batches' and column_name = 'activity_type_other';
--   -- 3. Counts, to compare after applying (nothing should change).
--   select (select count(*) from public.import_batches) as batches,
--          (select count(*) from public.activities where import_batch_id is not null) as imported_activities,
--          (select count(*) from public.import_rows) as import_rows;
--   -- 4. Run TEST A below (it works on the old functions) and keep its output.
--
-- Reversible: see REVERSE at the bottom (it puts back the two old forms; it keeps the
-- column and what's in it).

begin;

-- 1. The batch's "Please specify" text, with the 028 rule.
alter table public.import_batches add column if not exists activity_type_other text;
drop trigger if exists require_other_text on public.import_batches;
create trigger require_other_text before insert or update on public.import_batches
  for each row execute function public.require_other_text('activity_type', 'activity_type_other');

-- 2. One create_import_batch in place of the 022 and 029 forms.
drop function if exists public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb);
drop function if exists public.create_import_batch(text, text, integer, text, date, text, integer, jsonb);

create function public.create_import_batch(
  p_file_name text,
  p_file_hash text,
  p_row_count integer,
  p_activity_type text,
  p_activity_date date,
  p_description text,
  p_event_id integer,
  p_schools jsonb,
  p_rows jsonb default null,
  p_activity_type_other text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_batch uuid;
  v_count integer;
  -- Kept only for "other"; require_other_text refuses "other" without it.
  v_other text := case when p_activity_type = 'other' then nullif(btrim(p_activity_type_other), '') end;
begin
  -- As 022: the same checks, in the same order, with the same messages.
  if jsonb_typeof(p_schools) is distinct from 'array' or jsonb_array_length(p_schools) = 0 then
    raise exception 'An import batch needs at least one school';
  end if;
  if jsonb_array_length(p_schools) > 2000 then
    raise exception 'An import batch is limited to 2000 schools';
  end if;

  insert into public.import_batches
    (file_name, file_hash, row_count, activity_type, activity_type_other, activity_date, description, event_id)
  values
    (p_file_name, p_file_hash, p_row_count, p_activity_type, v_other, p_activity_date,
     coalesce(p_description, ''), p_event_id)
  returning batch_id into v_batch;

  insert into public.activities
    (school_id, activity_type, activity_type_other, date, description, event_id, import_batch_id, attendee_count)
  select s.school_id, p_activity_type, v_other, p_activity_date, coalesce(p_description, ''),
         p_event_id, v_batch, s.attendee_count
  from jsonb_to_recordset(p_schools) as s(school_id text, attendee_count integer);

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_schools) then
    raise exception 'Expected % activities, saved %', jsonb_array_length(p_schools), v_count;
  end if;

  -- As 029: the file's rows, when given.
  if p_rows is not null then
    perform public.insert_import_rows(v_batch, p_rows);
  end if;
  return v_batch;
end;
$fn$;

revoke all on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb, text) from public, anon;
grant execute on function public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb, text) to authenticated;

commit;

notify pgrst, 'reload schema';


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- TEST 1 — one function, its grants, and the column. Expect exactly one row:
-- create_import_batch(text,text,integer,text,date,text,integer,jsonb,jsonb,text), security
-- invoker (prosecdef false), search_path="", executable by authenticated and not anon;
-- then activity_type_other (text) on import_batches; then require_other_text on it.
-- select p.oid::regprocedure, p.prosecdef, p.proconfig,
--        has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
--        has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_import_batch';
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'import_batches' and column_name = 'activity_type_other';
-- select tgname from pg_trigger where tgrelid = 'public.import_batches'::regclass and tgname = 'require_other_text';

-- TEST A — the same input gives the same results, old functions or new. Run it BEFORE
-- applying (BEFORE APPLYING 4) and again after, and compare the two outputs line by line:
-- they must be identical. It saves an import as a made-up editor (not a real person),
-- writes down the batch row and its activities, tries the three errors, and undoes
-- everything (the work happens inside an inner block that always ends by raising an
-- exception; only the report survives, in a setting).
/*
do $testA$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000030e1';
  k1 text;
  k2 text;
  b uuid;
  r record;
  hash text := md5('test030') || md5('test030');
  many jsonb;
  n integer;
begin
  begin
    insert into public.user_roles (user_id, email, role) values (e, 'test030-editor@siue.edu', 'editor');
    select facility_key into k1 from public.schools where not archived order by facility_key limit 1;
    select facility_key into k2 from public.schools where not archived order by facility_key offset 1 limit 1;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                                               'email', 'test030-editor@siue.edu')::text, true);

    -- A1. An import of two schools (counts 2 and 1), called with 8 arguments by position.
    b := public.create_import_batch('test030.xlsx', hash, 3, 'visit', date '2026-10-01', '  TEST 030 import ', null,
           jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 2),
                             jsonb_build_object('school_id', k2, 'attendee_count', 1)));
    select file_name, file_hash = hash as hash_kept, row_count, activity_type, activity_date, description, event_id,
           created_by, archived into r
    from public.import_batches where batch_id = b;
    report := report || format('A1 batch: %s | hash kept %s | %s rows | %s | %s | "%s" | event %s | by %s | archived %s',
      r.file_name, r.hash_kept, r.row_count, r.activity_type, r.activity_date, r.description,
      coalesce(r.event_id::text, 'none'), r.created_by, r.archived) || E'\n';
    for r in
      select case when school_id = k1 then 'k1' else 'k2' end as s, activity_type, date, description,
             coalesce(event_id::text, 'none') as ev, attendee_count, contact_id, outcome, archived
      from public.activities where import_batch_id = b order by 1
    loop
      report := report || format('A1 activity %s: %s | %s | "%s" | event %s | %s visitors | contact %s | outcome %s | archived %s',
        r.s, r.activity_type, r.date, r.description, r.ev, r.attendee_count,
        coalesce(r.contact_id, 'none'), coalesce(r.outcome, 'none'), r.archived) || E'\n';
    end loop;

    -- A2. No schools.
    begin
      perform public.create_import_batch('test030.xlsx', hash, 0, 'visit', current_date, '', null, '[]'::jsonb);
      report := report || 'A2 no schools: accepted' || E'\n';
    exception when others then
      report := report || 'A2 no schools: ' || sqlerrm || E'\n';
    end;

    -- A3. 2001 schools.
    select jsonb_agg(jsonb_build_object('school_id', k1, 'attendee_count', 1)) into many from generate_series(1, 2001);
    begin
      perform public.create_import_batch('test030.xlsx', hash, 2001, 'visit', current_date, '', null, many);
      report := report || 'A3 2001 schools: accepted' || E'\n';
    exception when others then
      report := report || 'A3 2001 schools: ' || sqlerrm || E'\n';
    end;

    -- A4. A count mismatch: a trigger (owner, rolled back) silently skips k2's activity.
    reset role;
    create function pg_temp.skip_k2() returns trigger language plpgsql as $s$
    begin
      if new.description = 'TEST 030 mismatch' and new.school_id = (select facility_key from public.schools
           where not archived order by facility_key offset 1 limit 1) then return null; end if;
      return new;
    end $s$;
    create trigger test030_skip before insert on public.activities for each row execute function pg_temp.skip_k2();
    set local role authenticated;
    begin
      perform public.create_import_batch('test030.xlsx', hash, 2, 'visit', current_date, 'TEST 030 mismatch', null,
                jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 1),
                                  jsonb_build_object('school_id', k2, 'attendee_count', 1)));
      report := report || 'A4 count mismatch: accepted' || E'\n';
    exception when others then
      report := report || 'A4 count mismatch: ' || sqlerrm || E'\n';
    end;
    reset role;
    drop trigger test030_skip on public.activities;
    set local role authenticated;

    -- A5. With rows, called with 9 arguments by position (029's form): 2 rows saved, linked.
    b := public.create_import_batch('test030-rows.xlsx', hash, 2, 'event_participation', date '2026-10-02', 'TEST 030 rows', null,
           jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 2)),
           jsonb_build_array(jsonb_build_object('row_number', 2, 'school_as_typed', 'A', 'school_id', k1),
                             jsonb_build_object('row_number', 3, 'school_as_typed', 'A', 'school_id', k1, 'visitors', 1)));
    select count(*) as total, count(activity_id) as linked into r from public.import_rows where batch_id = b;
    report := report || format('A5 rows: %s saved, %s linked to the activity', r.total, r.linked) || E'\n';

    raise exception 'test030: undo everything';
  exception when others then
    if sqlerrm <> 'test030: undo everything' then
      report := report || 'STOPPED EARLY: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test030.report', report, false);
end
$testA$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test030.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test030-%') = 0
             and (select count(*) from public.import_batches where file_name like 'test030%') = 0
             and (select count(*) from public.activities where description like 'TEST 030%') = 0
            then 'rolled back: no test rows left'
            else 'NOT rolled back: test rows were left behind' end;
*/

-- TEST B — the new rules (after applying only). Select everything from "do $testB$" to
-- the end of the final select and run it. Expect every line to start with PASS.
/*
do $testB$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000030e2';
  v uuid := '00000000-0000-4000-8000-0000000030f2';
  k1 text;
  b uuid;
  r record;
  hash text := md5('test030b') || md5('test030b');
  one jsonb;
begin
  begin
    insert into public.user_roles (user_id, email, role) values
      (e, 'test030b-editor@siue.edu', 'editor'), (v, 'test030b-viewer@siue.edu', 'viewer');
    select facility_key into k1 from public.schools where not archived order by facility_key limit 1;
    one := jsonb_build_array(jsonb_build_object('school_id', k1, 'attendee_count', 3));
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                                               'email', 'test030b-editor@siue.edu')::text, true);

    -- 1. "other" needs its text: none, and blank, are refused.
    begin
      perform public.create_import_batch('test030b.xlsx', hash, 1, 'other', current_date, 'TEST 030b', null, one);
      report := report || 'FAIL 1 an Other import without text was saved' || E'\n';
    exception when check_violation then
      report := report || 'PASS 1 an Other import without text is refused' || E'\n';
    end;
    begin
      perform public.create_import_batch('test030b.xlsx', hash, 1, 'other', current_date, 'TEST 030b', null, one, null, '   ');
      report := report || 'FAIL 1b blank text was accepted' || E'\n';
    exception when check_violation then
      report := report || 'PASS 1b blank text is refused' || E'\n';
    end;

    -- 2. With text (by name, as the app calls it): the batch and its activity carry it.
    b := public.create_import_batch(p_file_name => 'test030b.xlsx', p_file_hash => hash, p_row_count => 1,
           p_activity_type => 'other', p_activity_date => current_date, p_description => 'TEST 030b',
           p_event_id => null, p_schools => one,
           p_rows => jsonb_build_array(jsonb_build_object('row_number', 2, 'school_as_typed', 'A', 'school_id', k1, 'visitor_name', 'TEST 030b Student')),
           p_activity_type_other => '  Career booth ');
    select (select activity_type_other from public.import_batches where batch_id = b) as on_batch,
           (select string_agg(activity_type_other, ',') from public.activities where import_batch_id = b) as on_activities,
           (select count(*) from public.import_rows where batch_id = b) as rows into r;
    report := report || case when r.on_batch = 'Career booth' and r.on_activities = 'Career booth' and r.rows = 1
      then 'PASS 2 the batch and its activity carry "Career booth", and the row is saved'
      else 'FAIL 2 batch ' || coalesce(r.on_batch, 'null') || ', activities ' || coalesce(r.on_activities, 'null') || ', rows ' || r.rows end || E'\n';

    -- 3. The text is kept only for "other": a visit with text stores none.
    b := public.create_import_batch('test030b.xlsx', hash, 1, 'visit', current_date, 'TEST 030b', null, one, null, 'ignored');
    select (select activity_type_other from public.import_batches where batch_id = b) as on_batch,
           (select count(activity_type_other) from public.activities where import_batch_id = b) as on_activities into r;
    report := report || case when r.on_batch is null and r.on_activities = 0
      then 'PASS 3 a visit keeps no Other text' else 'FAIL 3 a visit kept text' end || E'\n';

    -- 4. Only one create_import_batch now; the 022 and 029 forms are gone.
    report := report || case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_import_batch') = 1
             and to_regprocedure('public.create_import_batch(text,text,integer,text,date,text,integer,jsonb)') is null
             and to_regprocedure('public.create_import_batch(text,text,integer,text,date,text,integer,jsonb,jsonb)') is null
      then 'PASS 4 one create_import_batch; the two old forms are gone'
      else 'FAIL 4 the old forms are still there' end || E'\n';

    -- 5. A viewer can't save an import.
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated', 'aal', 'aal2',
                                                               'email', 'test030b-viewer@siue.edu')::text, true);
    begin
      perform public.create_import_batch('test030b.xlsx', hash, 1, 'visit', current_date, 'TEST 030b viewer', null, one);
      report := report || 'FAIL 5 a viewer saved an import' || E'\n';
    exception when insufficient_privilege then
      report := report || 'PASS 5 a viewer''s import is refused: ' || sqlerrm || E'\n';
    end;

    raise exception 'test030b: undo everything';
  exception when others then
    if sqlerrm <> 'test030b: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test030b.report', report, false);
end
$testB$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test030b.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test030b-%') = 0
             and (select count(*) from public.import_batches where file_name like 'test030b%') = 0
             and (select count(*) from public.activities where description like 'TEST 030b%') = 0
             and (select count(*) from public.import_rows where visitor_name like 'TEST 030b%') = 0
            then 'PASS 6 rolled back: no test rows left'
            else 'FAIL 6 test rows were left behind' end;
*/


-- ============================================================================
-- REVERSE (puts back the 022 and 029 forms; keeps the column and what's in it)
-- ============================================================================
/*
begin;
drop function if exists public.create_import_batch(text, text, integer, text, date, text, integer, jsonb, jsonb, text);
drop trigger if exists require_other_text on public.import_batches;
-- Then run section 4 of db/022 (the 8-argument create_import_batch, with its revoke and
-- grant) and section 4 of db/029 (the 9-argument form, with its revoke and grant).
commit;
notify pgrst, 'reload schema';
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   Applied 2026-11-13 in the SQL Editor. Results as reported:
--   * BEFORE APPLYING 1: the two old forms.
--   * BEFORE APPLYING 3: batches 4, imported activities 67, import_rows 2.
--   * Migration: success.
--   * TEST 1: require_other_text on import_batches; one create_import_batch (confirmed by
--     TEST B PASS 4); anon can't execute it, authenticated can; security invoker.
--   * TEST A, after: identical to the throwaway copy's output, all 8 lines. It wasn't run
--     on live before the migration; on the copy, before and after were identical.
--   * TEST B: all 7 PASS.
