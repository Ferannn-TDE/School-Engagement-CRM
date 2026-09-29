-- 008 — Testing dates don't count as events in the county views
--
-- Why: SAT/ACT/PSAT/AP exam days are busy dates, not outreach (plan item A3, db/007).
-- The app leaves them out of every event count and engagement number, but the two
-- county views count events in the database, so a school whose only "event" was an
-- SAT day showed as engaged, and county event totals included testing dates.
--
-- What changes: in both views, an event whose category is 'school_testing_date' is
-- ignored. Nothing else about the calculations changes. Events with no category
-- (every other event) count exactly as before.
--
-- No stored data changes: these are views, computed from the tables on every read.
-- CREATE OR REPLACE VIEW keeps the columns, their order, security_invoker = on and the
-- existing grants (no anon access), as in 005.
--
-- Snapshot of the previous definitions: the 005 definitions, confirmed identical to
-- the live ones on 2026-09-29 before applying, saved outside the repo at
--   ~/Desktop/CRM-db-exports/2026-09-29-step6-app-before/county_views_before_008.sql
-- UNDO: re-run the CREATE OR REPLACE statements in db/005 (same columns, so no drop).

begin;

create or replace view public.county_engagement_rate
  with (security_invoker = on) as
select county_name,
       total_schools,
       engaged_schools,
       case
         when total_schools > 0
           then round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
         else 0::numeric
       end as engagement_pct,
       state_code
  from (select s.county_name,
               s.state_code,
               count(*) as total_schools,
               count(*) filter (where exists (
                 select 1 from events e
                  where e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)
                    and e.category is distinct from 'school_testing_date'
               )) as engaged_schools
          from schools s
         group by s.county_name, s.state_code) sub
 order by (case
             when total_schools > 0
               then round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
             else 0::numeric
           end);

create or replace view public.county_school_summary
  with (security_invoker = on) as
select s.county_name,
       count(distinct s.facility_key) as total_schools,
       count(distinct s.facility_key) filter (where s.is_verified = true) as verified_schools,
       count(distinct c.staff_id) as total_contacts,
       count(distinct e.event_id) as total_events,
       count(distinct p.program_id) as total_programs,
       s.state_code
  from schools s
  left join contacts c on c.school_id = s.facility_key
  left join events e on e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)
                    and e.category is distinct from 'school_testing_date'
  left join programs p on p.school_id = s.facility_key and p.is_active = true
 group by s.county_name, s.state_code
 order by s.county_name, s.state_code;

commit;

-- Review: 219 rows in each view, security_invoker=on on both, no anon grant, and
-- sum(total_events) lower than before by the testing dates' school-county links.
