-- 028 — "Other: please specify" for program category, activity type and event type; save Event Type
--
-- DRAFT, NOT APPLIED. Run the BEFORE APPLYING checks, apply in the SQL Editor, then run
-- TEST 1–3 and paste the outputs into "Checked before applying" at the bottom.
--
-- Why: wherever a choice has "Other" (program category, event type, and now activity
-- type), choosing it asks "Please specify", and that text is shown instead of "Other".
-- The text needs somewhere to live. And the event form's Event Type has never been
-- saved: events have no type column, so the app showed "Outreach Fair" for scraped
-- events and "Other" for the rest. From now on it's saved; existing events show
-- "Not set" until someone edits them.
--
-- What it adds (all optional text, nothing backfilled):
--   * programs.category_other     — the text when category = 'other'.
--   * activities.activity_type_other — the text when activity_type = 'other'.
--   * events.event_type           — outreach_fair, campus_visit, recruitment_event,
--                                   summer_camp, workshop or other; NULL = "Not set".
--   * events.event_type_other     — the text when event_type = 'other'.
--   * require_other_text (before insert or update, on all three tables): "other" needs
--     its text (not blank), but only when the type or its text is being set: on insert,
--     or on an update that changes either. Any other update of an existing "other" row
--     without text (archive, restore, renaming, a scraper write) goes through. A CHECK
--     couldn't do this: even NOT VALID, it tests every update of the row.
--   * events.event_type only accepts the six values above (or NULL): a plain CHECK, as
--     every existing event has NULL.
--
-- Not affected: RLS and policies (003, 010, 023, 025), grants (021), the triggers on
-- these tables, the scraper (it never writes these columns: new scraped events have
-- event_type NULL, "Not set"), Reports' groupings (activity_type keeps its value;
-- the text is shown next to it).
--
-- BEFORE APPLYING (read-only):
--   -- 1. None of the new columns exist yet. Expect no rows.
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'public'
--     and (table_name, column_name) in (('programs', 'category_other'), ('activities', 'activity_type_other'),
--                                       ('events', 'event_type'), ('events', 'event_type_other'));
--   -- 2. Existing CHECK constraints on the three tables. If one limits programs.category
--   --    or activities.activity_type to a fixed list, stop and send me the output.
--   select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid in ('public.programs'::regclass, 'public.activities'::regclass, 'public.events'::regclass)
--     and contype = 'c'
--   order by 1, 2;
--   -- 3. Current values, to compare after applying (nothing should change).
--   select (select count(*) from public.programs) as programs,
--          (select count(*) from public.programs where category = 'other') as programs_other,
--          (select count(*) from public.activities) as activities,
--          (select count(*) from public.activities where activity_type = 'other') as activities_other,
--          (select count(*) from public.events) as events;
--
-- Reversible: see REVERSE at the bottom (it drops the triggers and the check and keeps
-- the columns and what's in them).

begin;

alter table public.programs   add column if not exists category_other text;
alter table public.activities add column if not exists activity_type_other text;
alter table public.events
  add column if not exists event_type text,
  add column if not exists event_type_other text;

alter table public.events add constraint events_event_type_known
  check (event_type is null or event_type in ('outreach_fair', 'campus_visit', 'recruitment_event', 'summer_camp', 'workshop', 'other'));

-- "other" needs its text, checked only when the type or the text is being set.
-- tg_argv: the type column, then its text column.
create or replace function public.require_other_text()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  type_col text := tg_argv[0];
  text_col text := tg_argv[1];
  n jsonb := to_jsonb(new);
  o jsonb;
begin
  if n ->> type_col is distinct from 'other' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if (n -> type_col) is not distinct from (o -> type_col)
       and (n -> text_col) is not distinct from (o -> text_col) then
      return new;  -- neither is being set: archive, restore and other edits go through
    end if;
  end if;
  if nullif(btrim(n ->> text_col), '') is null then
    raise exception '"Other" needs its text: fill in %', text_col using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists require_other_text on public.programs;
create trigger require_other_text before insert or update on public.programs
  for each row execute function public.require_other_text('category', 'category_other');
drop trigger if exists require_other_text on public.activities;
create trigger require_other_text before insert or update on public.activities
  for each row execute function public.require_other_text('activity_type', 'activity_type_other');
drop trigger if exists require_other_text on public.events;
create trigger require_other_text before insert or update on public.events
  for each row execute function public.require_other_text('event_type', 'event_type_other');

revoke all on function public.require_other_text() from public, anon;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 3, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the columns, the check and the triggers. Expect 4 columns (all text), the
-- constraint events_event_type_known, and require_other_text on programs, activities
-- and events.
-- select table_name, column_name, data_type from information_schema.columns
-- where table_schema = 'public'
--   and (table_name, column_name) in (('programs', 'category_other'), ('activities', 'activity_type_other'),
--                                     ('events', 'event_type'), ('events', 'event_type_other'))
-- order by 1, 2;
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname = 'events_event_type_known';
-- select tgrelid::regclass, tgname from pg_trigger where tgname = 'require_other_text' order by 1;

-- TEST 2 — nothing existing changed. Expect the same five numbers as BEFORE APPLYING
-- check 3, and 0 rows with any new column filled.
-- select (select count(*) from public.programs) as programs,
--        (select count(*) from public.programs where category = 'other') as programs_other,
--        (select count(*) from public.activities) as activities,
--        (select count(*) from public.activities where activity_type = 'other') as activities_other,
--        (select count(*) from public.events) as events,
--        (select count(*) from public.programs where category_other is not null)
--      + (select count(*) from public.activities where activity_type_other is not null)
--      + (select count(*) from public.events where event_type is not null or event_type_other is not null) as filled;

-- TEST 3 — the rules, written for the SQL Editor. Select everything from "do $test028$"
-- to the end of the final select and run it. It adds a made-up editor role row (not a
-- real person) and test rows, tries each rule as that editor, and undoes every change:
-- the work happens inside an inner block that always ends by raising an exception, and
-- only the report survives, in a setting. Expect every line to start with PASS.
/*
do $test028$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000028e1';
  k text;
  claims text;
  ok boolean;
begin
  begin
    insert into public.user_roles (user_id, email, role) values (e, 'test028-editor@siue.edu', 'editor');
    select facility_key into k from public.schools where not archived order by facility_key limit 1;

    set local role authenticated;
    claims := json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                'email', 'test028-editor@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);

    -- 1. Program category "other" needs its text.
    begin
      insert into public.programs (school_id, name, category) values (k, 'TEST 028 program', 'other');
      report := report || 'FAIL 1 a program saved as other without text' || E'\n';
    exception when check_violation then
      report := report || 'PASS 1 a program saved as other needs its text' || E'\n';
    end;
    begin
      insert into public.programs (school_id, name, category, category_other) values (k, 'TEST 028 program', 'other', '   ');
      report := report || 'FAIL 1b blank text was accepted' || E'\n';
    exception when check_violation then
      report := report || 'PASS 1b blank text is refused' || E'\n';
    end;
    insert into public.programs (school_id, name, category, category_other) values (k, 'TEST 028 program', 'other', 'Drone club');
    report := report || 'PASS 1c a program saved as other with text: Drone club' || E'\n';

    -- 2. Activity type "other" needs its text; a visitor count is allowed.
    begin
      insert into public.activities (school_id, activity_type, date, description) values (k, 'other', current_date, 'TEST 028 activity');
      report := report || 'FAIL 2 an activity saved as other without text' || E'\n';
    exception when check_violation then
      report := report || 'PASS 2 an activity saved as other needs its text' || E'\n';
    end;
    insert into public.activities (school_id, activity_type, activity_type_other, date, description, attendee_count)
    values (k, 'other', 'Career day booth', current_date, 'TEST 028 activity', 12);
    report := report || 'PASS 2b an activity saved as other with text and 12 visitors' || E'\n';

    -- 3. Event type: one of the six values or not set; "other" needs its text.
    begin
      insert into public.events (fair_name, date, is_scraped, event_type) values ('TEST 028 event', current_date, false, 'bogus');
      report := report || 'FAIL 3 an unknown event type was accepted' || E'\n';
    exception when check_violation then
      report := report || 'PASS 3 an unknown event type is refused' || E'\n';
    end;
    begin
      insert into public.events (fair_name, date, is_scraped, event_type) values ('TEST 028 event', current_date, false, 'other');
      report := report || 'FAIL 3b an event saved as other without text' || E'\n';
    exception when check_violation then
      report := report || 'PASS 3b an event saved as other needs its text' || E'\n';
    end;
    insert into public.events (fair_name, date, is_scraped, event_type, event_type_other)
    values ('TEST 028 event', current_date, false, 'other', 'Alumni panel');
    insert into public.events (fair_name, date, is_scraped, event_type) values ('TEST 028 event', current_date, false, 'campus_visit');
    insert into public.events (fair_name, date, is_scraped) values ('TEST 028 event', current_date, false);
    report := report || 'PASS 3c other with text, campus_visit, and not set are all accepted' || E'\n';

    -- 4. Existing "other" rows without text (as saved before 028) can still be archived,
    --    restored and edited; only setting the type or the text asks for it. Made here as
    --    the owner with the trigger switched off for a moment (rolled back like the rest).
    reset role;
    perform set_config('request.jwt.claims', '', true);
    alter table public.programs disable trigger require_other_text;
    alter table public.activities disable trigger require_other_text;
    insert into public.programs (school_id, name, category) values (k, 'TEST 028 old program', 'other');
    insert into public.activities (school_id, activity_type, date, description) values (k, 'other', current_date, 'TEST 028 old activity');
    alter table public.programs enable trigger require_other_text;
    alter table public.activities enable trigger require_other_text;

    set local role authenticated;
    perform set_config('request.jwt.claims', claims, true);
    begin
      update public.programs set archived = true where name = 'TEST 028 old program';
      update public.programs set archived = false where name = 'TEST 028 old program';
      update public.activities set archived = true where description = 'TEST 028 old activity';
      update public.activities set archived = false where description = 'TEST 028 old activity';
      report := report || 'PASS 4 an existing "other" program and activity with no text archive and restore' || E'\n';
    exception when check_violation then
      report := report || 'FAIL 4 archiving an existing "other" row was refused: ' || sqlerrm || E'\n';
    end;
    begin
      update public.programs set name = 'TEST 028 old program renamed' where name = 'TEST 028 old program';
      report := report || 'PASS 4b renaming it goes through too' || E'\n';
    exception when check_violation then
      report := report || 'FAIL 4b renaming an existing "other" row was refused' || E'\n';
    end;
    begin
      update public.programs set category_other = '  ' where name = 'TEST 028 old program renamed';
      report := report || 'FAIL 4c setting blank text was accepted' || E'\n';
    exception when check_violation then
      report := report || 'PASS 4c setting its text to blank is refused' || E'\n';
    end;
    begin
      update public.programs set category = 'robotics' where name = 'TEST 028 old program renamed';
      update public.programs set category = 'other' where name = 'TEST 028 old program renamed';
      report := report || 'FAIL 4d switching back to other without text was accepted' || E'\n';
    exception when check_violation then
      report := report || 'PASS 4d switching a row to other without text is refused' || E'\n';
    end;

    raise exception 'test028: undo everything';
  exception when others then
    if sqlerrm <> 'test028: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test028.report', report, false);
end
$test028$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test028.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test028-%') = 0
             and (select count(*) from public.programs where name like 'TEST 028%') = 0
             and (select count(*) from public.activities where description like 'TEST 028%') = 0
             and (select count(*) from public.events where fair_name = 'TEST 028 event') = 0
            then 'PASS 5 rolled back: no test rows left'
            else 'FAIL 5 test rows were left behind' end;
*/


-- ============================================================================
-- REVERSE (drops the checks; keeps the columns and what's in them)
-- ============================================================================
/*
begin;
drop trigger if exists require_other_text on public.programs;
drop trigger if exists require_other_text on public.activities;
drop trigger if exists require_other_text on public.events;
drop function if exists public.require_other_text();
alter table public.events drop constraint if exists events_event_type_known;
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   Applied 2026-11-12 in the SQL Editor. Results as reported:
--   * BEFORE APPLYING 2: only activities_attendee_count_check, so no fixed lists.
--   * BEFORE APPLYING 3: programs 0, programs_other 0, activities 74,
--     activities_other 0, events 254.
--   * Migration: success.
--   * TEST 1: require_other_text on events, activities and programs.
--   * TEST 2: the same counts; filled 0.
--   * TEST 3: all 13 PASS.
--   Before applying, TEST 3 also passed on a throwaway copy, where the earlier NOT VALID
--   checks were shown to refuse archiving an existing "other" row without text.
