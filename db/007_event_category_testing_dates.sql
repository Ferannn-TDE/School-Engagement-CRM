-- 007 — Give events a category, and mark the existing school testing dates
--
-- Why: the client doesn't do outreach on SAT/ACT/PSAT/AP exam days, but wants to see
-- them as busy dates for each school (plan item A3: "testing dates are a category, not
-- a filter"). The events table had no category column, so these events looked like any
-- other. Nothing is hidden or removed here; the app decides later how to show them.
--
-- What changes:
--   * events gains a nullable text column, category. Every existing row starts NULL.
--   * School-calendar rows (external_id 'schoolreach:%') that the scraper's
--     EventParser.category() would label school_testing_date get that category.
--     On 2026-09-29 that is 15 rows; all 15 are SAT, ACT or PSAT titles. No other
--     column changes, and no other row changes.
--
-- The matching rules are the scraper's, from the scraper-fixes branch (1bf3038, plus
-- 11bc5db, which adds AP exams). The scraper matches on title, location and
-- description; only title (fair_name) and location are stored, so those two are used.
--   1. Rows with a rejected word (football, lunch, concert, ...) are never events, so
--      never testing dates (helpers.EVENT_REJECT).
--   2. SAT, ACT or PSAT as a whole word, capitals as written. "Sat, Aug 22" and
--      "Activity" don't match (helpers.TESTING_DATE_TERMS).
--   3. AP as a whole word, only when the text after it says exam(s), test(s) or
--      testing in any case. "AP Celebration Day" doesn't match.
--   4. "sat" in any case directly followed by exam, test, testing, assessment,
--      administration or school day ("Sat testing administration").
-- IACAC events are always college_planning in the scraper, so they are not touched.
-- Events created in the app are not touched either.
--
-- Snapshot of every events row before this migration (outside the repo):
--   ~/Desktop/CRM-db-exports/2026-09-29-phase5-step6-before/events.json
-- No existing value changes: the column is new, so the old value of every row is
-- "no column". The UNDO section at the bottom removes the category values this
-- migration set without dropping the column.
--
-- Not in this migration (listed under "draft later" and in the app work for step 6):
-- the scraper writing category on new events, and the app's testing-dates toggle and
-- busy-dates list. Until the scraper writes it, new testing dates arrive with NULL.
--
-- Safe to run twice: only rows whose category is still NULL are updated.

begin;

alter table public.events
  add column if not exists category text;

comment on column public.events.category is
  'What kind of event this is, e.g. school_testing_date (SAT/ACT/PSAT/AP exam days: '
  'busy dates, not outreach). NULL = not categorised. Set by db/007 for existing rows.';

update public.events e
set category = 'school_testing_date'
where e.category is null
  and e.external_id like 'schoolreach:%'
  and not (concat_ws(' ', e.fair_name, e.location) ~*
    '\y(varsity|junior\s+varsity|football|basketball|baseball|softball|volleyball|soccer|tennis|wrestling|track\s+meet|lunch|menu|board\s+meeting|car\s+wash|homecoming\s+(dance|bonfire)|concert|rehearsal)\y')
  and (
    concat_ws(' ', e.fair_name, e.location) ~ '\y(SAT|ACT|PSAT)\y'
    or substring(concat_ws(' ', e.fair_name, e.location) from '\yAP\y(.*)$')
       ~* '\y(exams?|tests?|testing)\y'
    or concat_ws(' ', e.fair_name, e.location) ~*
       '\ysat\s+(exam|test|testing|assessment|administration|school\s+day)\y'
  );

commit;

-- Review after applying (expected on 2026-09-29: 15 rows, event_ids
-- 9, 12, 26, 28, 31, 43, 46, 53, 61, 194, 211, 836, 848, 852, 886):
--   select event_id, fair_name from public.events
--   where category = 'school_testing_date' order by event_id;

-- UNDO (keeps the column; clears only what this migration set):
--   update public.events set category = null
--   where category = 'school_testing_date'
--     and event_id in (9, 12, 26, 28, 31, 43, 46, 53, 61, 194, 211, 836, 848, 852, 886);
-- To remove the column entirely once nothing reads it:
--   alter table public.events drop column category;
