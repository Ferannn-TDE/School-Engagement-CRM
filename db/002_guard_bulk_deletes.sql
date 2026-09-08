-- 002 — Block bulk DELETE from the application (Mitigation B)
--
-- ============================================================================
-- THE THRESHOLD IS 100. DO NOT CHANGE IT WITHOUT RE-RUNNING THE DERIVATION.
-- ============================================================================
--
-- Derived 2026-09-08, not guessed:
--
--   * The largest legitimate single-statement delete anywhere in the database was
--     **25 rows**. That is the worst case of the school cascade in
--     `deleteSchool` (src/services/schoolsService.ts:272-298), which issues THREE
--     separate multi-row statements for one school:
--         contacts .delete().in('staff_id', staffIds)
--         contacts .delete().eq('school_id', id)
--         staff    .delete().in('staff_id', staffIds)
--     The trigger sees each of those separately, so the cap must clear the largest
--     single one, not their sum.
--
--   * 25 is the top of a smooth curve (25, 24, 21, 19, 19, 17, ...), not a lone
--     outlier. That is what makes a cap viable here: there is a wide, empty gap
--     between "one big school" (~25) and "someone wiping a chunk of the database"
--     (hundreds). Had the max been near ~300 this guard would not have been able to
--     tell those apart and a different mechanism would have been needed.
--
--   * 100 = 25 x 3 = 75, rounded up to a round number. Roughly 4x real headroom, so
--     a school quadrupling in size or an import padding staff will not trip it.
--
-- IF A LEGITIMATE DELETE EVER TRIPS THIS CAP:
--   Re-run the derivation query at the bottom of this file and re-derive the number.
--   Do NOT simply raise the cap. A cap raised blindly to silence an error is the same
--   as having no cap: 1000 would let a real mass-delete through untouched.
--
-- WHAT THIS DOES AND DOES NOT PROTECT AGAINST:
--   Stops: the catastrophic single-request wipe, and the fat-finger.
--          (Supabase rejects a filter-less DELETE, but `?facility_key=like.*`
--          satisfies that check and would otherwise remove all 1,683 schools.)
--   Does NOT stop: a determined holder of the client credential deleting rows one
--          request at a time, or in sub-100 batches. This is a guardrail against a
--          single destructive action, NOT access control. Real separation needs the
--          admin/client tier split.
--
-- SCRAPER EXEMPTION:
--   PostgREST sets `request.jwt.claims` on every API request. The scraper connects
--   directly over DATABASE_URL as the table owner, where that setting is empty. The
--   guard skips when it is empty, so the pipeline is unaffected and can still do
--   large legitimate maintenance deletes.

begin;

create or replace function public.guard_bulk_delete()
returns trigger
language plpgsql
as $$
declare
  affected int;
begin
  -- Not a PostgREST request (no JWT claims) => owner/scraper connection. Exempt.
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then
    return null;
  end if;

  select count(*) into affected from deleted;

  if affected > 100 then
    raise exception
      'Bulk delete blocked: % rows in one statement on %.% (limit 100)',
      affected, tg_table_schema, tg_table_name
      using hint = 'Largest legitimate cascade observed was 25 rows. If a real delete '
                   'now exceeds 100, re-run the derivation query in db/002 rather than '
                   'raising the cap.';
  end if;

  return null;
end;
$$;

-- Attached only to the tables the application actually deletes from.
-- district / county / state are omitted: db/001 denies DELETE on them outright.
drop trigger if exists guard_bulk_delete on public.schools;
create trigger guard_bulk_delete after delete on public.schools
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

drop trigger if exists guard_bulk_delete on public.staff;
create trigger guard_bulk_delete after delete on public.staff
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

drop trigger if exists guard_bulk_delete on public.contacts;
create trigger guard_bulk_delete after delete on public.contacts
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

drop trigger if exists guard_bulk_delete on public.events;
create trigger guard_bulk_delete after delete on public.events
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

drop trigger if exists guard_bulk_delete on public.programs;
create trigger guard_bulk_delete after delete on public.programs
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

drop trigger if exists guard_bulk_delete on public.activities;
create trigger guard_bulk_delete after delete on public.activities
  referencing old table as deleted for each statement
  execute function public.guard_bulk_delete();

commit;


-- ============================================================================
-- VERIFICATION — run these after applying. Tests 1 and 2 are rollback-wrapped
-- and cannot lose data.
-- ============================================================================

-- TEST 1 — over-cap delete must RAISE and roll back.
-- NOTE: the SQL Editor is not a PostgREST request, so request.jwt.claims is empty
-- and the guard would exempt it. set_config simulates an API caller, which is the
-- only way this test means anything.
--   Expected: ERROR  Bulk delete blocked: 150 rows in one statement on public.staff
/*
begin;
  select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  delete from public.staff
   where staff_id in (select staff_id from public.staff limit 150);
rollback;
*/

-- TEST 2 — a normal single-row delete must still SUCCEED.
--   Expected: DELETE 1, then rolled back.
/*
begin;
  select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  delete from public.staff
   where staff_id in (select staff_id from public.staff limit 1);
rollback;
*/

-- TEST 3 — scraper exemption. On a connection with no JWT claims this returns true,
-- which is the branch that lets the pipeline through. Running it in the SQL Editor is
-- a proxy for the scraper's direct connection; confirm over DATABASE_URL for certainty.
--   Expected: exempt = true
/*
select coalesce(current_setting('request.jwt.claims', true), '') = '' as exempt;
*/


-- ============================================================================
-- DERIVATION QUERY — re-run this before ever changing the threshold.
-- ============================================================================
/*
with staff_per_school as (
  select school_worked_at as school, count(*) as n
  from public.staff where school_worked_at is not null group by 1
),
contacts_by_school as (
  select school_id as school, count(*) as n from public.contacts group by 1
),
contacts_by_staff_set as (
  select s.school_worked_at as school, count(*) as n
  from public.contacts c
  join public.staff s on s.staff_id = c.staff_id
  where s.school_worked_at is not null group by 1
)
select 'staff deleted per school' as statement, max(n) as max_rows from staff_per_school
union all select 'contacts by school_id',       max(n) from contacts_by_school
union all select 'contacts by staff_id set',    max(n) from contacts_by_staff_set
order by max_rows desc;
*/
