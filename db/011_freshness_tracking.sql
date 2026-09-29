-- 011 — Freshness: when was each record last seen, and is its source still working
--
-- Why: plan items C8. The client needs to see, in plain words, when a record may be
-- out of date: "Not verified in 6+ months", "Website link broken", "No longer listed
-- on the school's site". Nothing recorded this until now.
--
-- What changes (all new columns; every existing row starts empty, so no value changes):
--   schools
--     last_scraped_at    when a scraper run last found this school
--     source_status      the school's website as the scraper last saw it:
--                        'working', 'broken' (the link fails) or 'not_found' (no site)
--     source_checked_at  when source_status was last checked
--     missed_runs        complete scraper runs in a row that didn't find the school
--     missing_since      set once missed_runs reaches 3; cleared when found again
--   staff
--     last_scraped_at, missed_runs, missing_since   (the same, for a person on the
--                                                     school's staff page)
--
-- The "3 misses" rule is enforced here, not only in the scraper: missing_since can't
-- be set until missed_runs is at least 3. A missing record is flagged, never deleted
-- (db/009, db/010).
--
-- These are bookkeeping columns: the db/006 edit locks don't cover them, so the
-- scraper can always update them, and a client edit never locks them.
--
-- The scraper doesn't write them yet (listed under "draft later" for seandsw), so for
-- now every record shows no freshness flag except "Not verified in 6+ months", which
-- the app works out from last_verified_at (already stored).
--
-- Snapshot before applying (outside the repo): schools and staff in
--   ~/Desktop/CRM-db-exports/2026-09-29-phase5-step4-before/
-- Reversible: drop the columns (they hold nothing until the scraper writes them).

begin;

alter table public.schools
  add column if not exists last_scraped_at timestamptz,
  add column if not exists source_status text,
  add column if not exists source_checked_at timestamptz,
  add column if not exists missed_runs integer not null default 0,
  add column if not exists missing_since timestamptz;

alter table public.schools
  add constraint schools_source_status_values
    check (source_status is null or source_status in ('working', 'broken', 'not_found')),
  add constraint schools_missed_runs_not_negative check (missed_runs >= 0),
  add constraint schools_missing_after_three_runs
    check (missing_since is null or missed_runs >= 3);

alter table public.staff
  add column if not exists last_scraped_at timestamptz,
  add column if not exists missed_runs integer not null default 0,
  add column if not exists missing_since timestamptz;

alter table public.staff
  add constraint staff_missed_runs_not_negative check (missed_runs >= 0),
  add constraint staff_missing_after_three_runs
    check (missing_since is null or missed_runs >= 3);

comment on column public.schools.source_status is
  'The school website as the scraper last saw it: working, broken (link fails) or not_found. NULL = not checked yet.';
comment on column public.schools.missing_since is
  'Set by the scraper only after 3 complete runs in a row without finding the school (missed_runs >= 3). Flag only; never deleted.';
comment on column public.staff.missing_since is
  'Set by the scraper only after 3 complete runs in a row without finding the person on the school site (missed_runs >= 3). Flag only; never deleted.';

commit;

-- Review: the new columns exist, every row is empty, and the constraints are in place.
--   select count(*) filter (where last_scraped_at is not null or source_status is not null
--            or source_checked_at is not null or missed_runs <> 0 or missing_since is not null)
--   from public.schools;                               -- expect 0
--   select conname from pg_constraint
--   where conname like 'schools_%' or conname like 'staff_%missing%' or conname like 'staff_missed%';
