-- 005 — Keep same-named counties in Illinois and Missouri apart
--
-- Why: both county views grouped by county_name alone. 40 county names exist in both
-- states (Madison, Jefferson, Clay, Monroe, ...), covering 465 schools, so each pair was
-- merged into one row. Madison showed 19 schools; really 17 in Illinois and 2 in Missouri.
--
-- What changes: each view now groups by county_name AND state_code, and gains a
-- state_code column at the end. Nothing else about the calculations changes.
--   Rows before: 179 in each view. Rows after: 219 (the distinct county/state pairs).
--
-- No stored data changes: these are views, computed from the tables on every read.
--
-- Kept exactly as before:
--   * security_invoker = on, so the views still run as the signed-in user and the
--     aal2 rule on schools (db/003) still applies through them.
--   * Permissions. CREATE OR REPLACE VIEW keeps existing grants, so anon still has
--     none (revoked 2026-09-07). Checked after applying; see the review query below.
--   * Column order. New columns can only be added at the end of a view, which is why
--     state_code comes last.
--
-- Snapshot of the previous definitions (outside the repo):
--   ~/Desktop/CRM-db-exports/2026-09-28-phase3/county_views_before_005.sql
-- The same definitions are in the UNDO section at the bottom of this file.

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
  left join programs p on p.school_id = s.facility_key and p.is_active = true
 group by s.county_name, s.state_code
 order by s.county_name, s.state_code;

commit;

-- Review: expect 219 rows in each view, two Madison rows (IL 17, MO 2),
-- security_invoker=on on both, and no anon grant.
select 'engagement rows' as item, count(*)::text as result from public.county_engagement_rate
union all select 'summary rows', count(*)::text from public.county_school_summary
union all select 'Madison', string_agg(state_code || ' ' || total_schools, ', ' order by state_code)
  from public.county_school_summary where county_name = 'Madison'
union all select c.relname || ' options', array_to_string(c.reloptions, ',')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('county_engagement_rate', 'county_school_summary')
union all select 'anon grants on county views', count(*)::text
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'
   and table_name in ('county_engagement_rate', 'county_school_summary');


-- ============================================================================
-- UNDO — restores the pre-005 views exactly.
--
-- A view's columns can't be removed with CREATE OR REPLACE, so undo has to drop and
-- recreate. Views hold no data, so nothing is lost. Dropping resets permissions, and
-- Supabase's default privileges would GRANT anon access to a recreated view in public,
-- which would reopen what was closed on 2026-09-07. The grants below restore exactly
-- what existed before, including no anon access. Run as one block.
-- ============================================================================
/*
begin;

drop view public.county_engagement_rate;
drop view public.county_school_summary;

create view public.county_engagement_rate with (security_invoker = on) as
SELECT county_name,
    total_schools,
    engaged_schools,
    CASE
        WHEN total_schools > 0 THEN round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
        ELSE 0::numeric
    END AS engagement_pct
   FROM ( SELECT s.county_name,
            count(*) AS total_schools,
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM events e
                  WHERE e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)))) AS engaged_schools
           FROM schools s
          GROUP BY s.county_name) sub
  ORDER BY (
        CASE
            WHEN total_schools > 0 THEN round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END);

create view public.county_school_summary with (security_invoker = on) as
SELECT s.county_name,
    count(DISTINCT s.facility_key) AS total_schools,
    count(DISTINCT s.facility_key) FILTER (WHERE s.is_verified = true) AS verified_schools,
    count(DISTINCT c.staff_id) AS total_contacts,
    count(DISTINCT e.event_id) AS total_events,
    count(DISTINCT p.program_id) AS total_programs
   FROM schools s
     LEFT JOIN contacts c ON c.school_id = s.facility_key
     LEFT JOIN events e ON e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)
     LEFT JOIN programs p ON p.school_id = s.facility_key AND p.is_active = true
  GROUP BY s.county_name
  ORDER BY s.county_name;

revoke all on public.county_engagement_rate, public.county_school_summary from public, anon;
grant all on public.county_engagement_rate, public.county_school_summary to authenticated, service_role;

commit;
*/
