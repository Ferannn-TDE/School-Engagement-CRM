-- 014 — A column for the scraper's contact score, so it stops going into notes
--
-- Why: the scraper rates how confident it is that a person really works at the school
-- (models.Contact.score, e.g. 8.5) and writes that number into staff.notes, the field
-- people use for their own notes. With the scraper-fixes rule "never replace notes,
-- keep both", every run with a changed score would add another line. Decided
-- 2026-09-29: give the score its own column. Phase 5 step 5b.
--
-- What changes: two new columns on staff, empty on every row:
--   scraper_score     the scraper's confidence score for this person (0 or more)
--   scraper_score_at  when the scraper last wrote it
-- Nothing else changes. In particular the scores already in notes stay exactly where
-- they are: on 2026-09-30 all 4,243 staff notes were a score and nothing else (11
-- values, 4.8 to 8.75), none written by a person. Copying them into scraper_score is
-- a separate decision, not part of this migration.
--
-- Bookkeeping columns: the db/006 edit locks don't cover them, so a client edit never
-- locks them and the scraper can always write them. Writing the score here instead of
-- notes is the matching scraper change, on seandsw's draft-later list.
--
-- Snapshot before applying (outside the repo): staff in
--   ~/Desktop/CRM-db-exports/2026-09-30-phase5-step5b-before/
-- Reversible: drop the two columns.

begin;

alter table public.staff
  add column if not exists scraper_score numeric,
  add column if not exists scraper_score_at timestamptz;

alter table public.staff
  add constraint staff_scraper_score_not_negative check (scraper_score is null or scraper_score >= 0);

comment on column public.staff.scraper_score is
  'How confident the scraper is that this person works at the school (e.g. 8.5). Written by the scraper; not a note.';
comment on column public.staff.scraper_score_at is
  'When the scraper last wrote scraper_score.';

commit;
