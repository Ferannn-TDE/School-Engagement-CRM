-- 018 — Copy the scraper's scores from notes into staff.scraper_score (approved 2026-10-01)
--
-- Why: db/014 gave the score its own column, empty until the scraper writes it there
-- (Part 3, scraper side). The scores are already in notes: on 2026-10-01, after the
-- restore (db/015), every one of the 4,352 staff notes was a score and nothing else
-- (11 values, 4.8 to 8.75). Copying them now fills the column without waiting for a
-- scraper run.
--
-- What changes: scraper_score is set from notes, only where notes is a plain number
-- and scraper_score is still empty. notes itself is NOT changed: whether to clear the
-- scores out of notes is a separate decision. scraper_score_at stays NULL, because when
-- each score was written isn't known (the next scraper run will stamp it).
--
-- scraper_score isn't covered by the db/006 locks, so no field gets locked.
-- Snapshot before applying (outside the repo):
--   ~/Desktop/CRM-db-exports/2026-10-01-after-restore/staff.json
-- UNDO: update public.staff set scraper_score = null where scraper_score_at is null;

begin;

do $check$
declare already int;
begin
  select count(*) into already from public.staff where scraper_score is not null;
  if already > 0 then
    raise exception '% staff already have a scraper_score; nothing was copied.', already;
  end if;
end $check$;

update public.staff
   set scraper_score = btrim(notes)::numeric
 where scraper_score is null
   and notes ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';

commit;

-- Review: every staff row whose notes is a number has the same scraper_score, and notes
-- is unchanged.
--   select count(*) filter (where scraper_score is not null) as copied,
--          count(*) filter (where notes ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
--                            and scraper_score is distinct from btrim(notes)::numeric) as mismatched
--   from public.staff;
