-- Reports page: every figure, worked out in SQL. Read-only: one SELECT.
--
-- Use: set the four values in params (the date range, today, and '' for All or
-- 'IL' / 'MO'), run in the SQL Editor, and compare each figure with the Reports page
-- for the same range and state. Keys match reportSnapshot() in src/utils/reports.ts;
-- scripts/verify-reports-sql.ts runs this on a throwaway Postgres against the same
-- fixture as the TypeScript and fails if any figure differs.
--
-- It follows the app's loading rules, not just the tables: archived rows left out;
-- a contact belongs to its junction row's school, else staff.school_worked_at, and is
-- dropped when that school is archived; activities count only on listed schools;
-- testing dates are never outreach; Event impact ranks only events with imported
-- attendance (activities with an import batch and this event); an event with no known school is placed in a
-- state by its location (as utils/region.ts does). The thresholds are the ones in
-- src/constants/reportSettings.ts: keep the two in step.
with
params as (
  select date '2026-08-24' as range_start, date '2026-10-27' as range_end,  -- PARAMS
         date '2026-10-27' as today, ''::text as region,                     -- PARAMS
         60 as follow_up_days, interval '6 months' as quiet, interval '6 months' as verified_recent,
         'school_testing_date'::text as testing, 'event_participation'::text as attendance
),
all_sch as (
  select facility_key as id, coalesce(state_code, '') as state,
         coalesce(nullif(btrim(county_name), ''), '(no county)') as county, source_status
  from schools where not archived
),
sch as (select s.* from all_sch s, params p where p.region = '' or s.state = p.region),
act as (
  select a.activity_id as id, a.event_id, a.school_id, a.activity_type as type, a.date::date as day,
         a.import_batch_id, a.attendee_count
  from activities a join sch on sch.id = a.school_id
  where not a.archived
),
act_in as (select act.* from act, params p where act.day between p.range_start and p.range_end),
junction as (select staff_id, max(school_id) as school_id from contacts where not archived group by staff_id),
con as (
  select s.staff_id as id, coalesce(j.school_id, s.school_worked_at, '') as school_id,
         coalesce(s.is_active, true) as active,
         (s.last_verified_at at time zone 'UTC')::date as verified_day,
         s.last_scraped_at is not null as scraped
  from staff s left join junction j on j.staff_id = s.staff_id
  where not s.archived
),
con_l as (select con.* from con join sch on sch.id = con.school_id),
per_school as (
  select sch.id, sch.state, sch.county, count(con_l.id) filter (where con_l.active) as active_contacts
  from sch left join con_l on con_l.school_id = sch.id
  group by sch.id, sch.state, sch.county
),
ev_all as (
  select e.event_id as id, coalesce(e.date, p.today) as day, coalesce(e.category, '') as category,
         array(select btrim(x) from unnest(string_to_array(coalesce(e.schools_involved, ''), ',')) x
               where btrim(x) <> '') as schools,
         case
           when ' ' || coalesce(e.location, '') || ' ' ~* '(,\s*IL\y|\yIllinois\y|\yIL\s+6[0-2]\d{3}\y)'
            and not ' ' || coalesce(e.location, '') || ' ' ~* '(,\s*MO\y|\yMissouri\y|\yMO\s+6[3-5]\d{3}\y)' then 'IL'
           when ' ' || coalesce(e.location, '') || ' ' ~* '(,\s*MO\y|\yMissouri\y|\yMO\s+6[3-5]\d{3}\y)'
            and not ' ' || coalesce(e.location, '') || ' ' ~* '(,\s*IL\y|\yIllinois\y|\yIL\s+6[0-2]\d{3}\y)' then 'MO'
         end as location_state
  from events e, params p
  where not e.archived
),
ev as (
  select ev_all.* from ev_all, params p
  where ev_all.category <> p.testing
    and (p.region = ''
      or case when exists (select 1 from all_sch s where s.id = any(ev_all.schools) and s.state <> '')
              then exists (select 1 from all_sch s where s.id = any(ev_all.schools) and s.state = p.region)
              else ev_all.location_state is not distinct from p.region end)
),
first_day as (select school_id, min(day) as day from act group by school_id),
last_day as (select act.school_id, max(act.day) as day from act, params p where act.day <= p.range_end group by act.school_id),
-- Event impact: past events in the range with imported attendance (rows saved with the event chosen).
att as (
  select ev.id as event_id, ev.day, a.school_id, a.attendee_count
  from ev join act a on a.event_id = ev.id and a.import_batch_id is not null, params p
  where ev.day between p.range_start and p.range_end and ev.day < p.today
),
fu as (
  select x.event_id, x.day, x.school_id,
         exists (select 1 from act a, params p where a.school_id = x.school_id and a.type <> p.attendance
                 and a.event_id is distinct from x.event_id
                 and a.day > x.day and a.day <= x.day + p.follow_up_days) as followed,
         x.day + p.follow_up_days >= p.today as window_open
  from (select distinct event_id, day, school_id from att) x, params p
),
figures(k, v) as (
            select 'schools.total', count(*) from sch
  union all select 'reach.engaged', count(distinct school_id) from act_in
  union all select 'reach.first_time', count(*) from first_day, params p
            where first_day.day between p.range_start and p.range_end
  union all select 'reach.state.' || coalesce(nullif(sch.state, ''), '(none)') || '.total', count(*) from sch group by sch.state
  union all select 'reach.state.' || coalesce(nullif(sch.state, ''), '(none)') || '.engaged',
                   count(*) filter (where sch.id in (select school_id from act_in)) from sch group by sch.state
  union all select 'activity.total', count(*) from act_in
  union all select 'activity.students', coalesce(sum(attendee_count), 0) from act_in
            where import_batch_id is not null and attendee_count is not null
  union all select 'activity.student_rows', count(*) from act_in
            where import_batch_id is not null and attendee_count is not null
  union all select 'activity.months_with_data', count(distinct to_char(day, 'YYYY-MM')) from act_in
  union all select 'activity.type.' || type, count(*) from act_in group by type
  union all select 'month.' || to_char(day, 'YYYY-MM') || '.activities', count(*) from act_in group by 1
  union all select 'month.' || to_char(day, 'YYYY-MM') || '.schools', count(distinct school_id) from act_in group by 1
  union all select 'month.' || to_char(a.day, 'YYYY-MM') || '.new_schools',
                   count(distinct a.school_id) filter (where to_char(f.day, 'YYYY-MM') = to_char(a.day, 'YYYY-MM'))
            from act_in a join first_day f on f.school_id = a.school_id group by 1
  union all select 'month.' || to_char(day, 'YYYY-MM') || '.students',
                   coalesce(sum(attendee_count) filter (where import_batch_id is not null), 0) from act_in group by 1
  union all select 'contacts.total', count(*) from con_l
  union all select 'contacts.active', count(*) from con_l where active
  union all select 'coverage.with', count(*) from per_school where active_contacts > 0
  union all select 'coverage.without', count(*) from per_school where active_contacts = 0
  union all select 'coverage.state.' || coalesce(nullif(state, ''), '(none)') || '.without',
                   count(*) filter (where active_contacts = 0) from per_school group by state
  union all select 'coverage.bucket.' || b.label, count(ps.id)
            from (values ('0', 0, 0), ('1', 1, 1), ('2-5', 2, 5), ('6-15', 6, 15), ('16+', 16, 1000000)) b(label, lo, hi)
            left join per_school ps on ps.active_contacts between b.lo and b.hi group by b.label
  union all select 'coverage.county.' || state || '|' || county || '.total', count(*) from per_school group by state, county
  union all select 'coverage.county.' || state || '|' || county || '.without',
                   count(*) filter (where active_contacts = 0) from per_school group by state, county
  union all select 'events.past', count(*) from ev, params p where ev.day between p.range_start and p.range_end and ev.day < p.today
  union all select 'events.upcoming', count(*) from ev, params p where ev.day >= p.today
  union all select 'events.upcoming_with_schools', count(*) from ev, params p where ev.day >= p.today and cardinality(ev.schools) > 0
  union all select 'events.upcoming.' || to_char(ev.day, 'YYYY-MM'), count(*) from ev, params p where ev.day >= p.today group by 1
  union all select 'impact.events', count(distinct event_id) from att
  union all select 'impact.schools', count(*) from fu
  union all select 'impact.students', coalesce(sum(attendee_count), 0) from att
  union all select 'impact.followed', count(*) from fu where followed
  union all select 'impact.closed_schools', count(*) from fu where not window_open
  union all select 'impact.closed_followed', count(*) from fu where followed and not window_open
  union all select 'gaps.never', count(*) from sch where id not in (select school_id from last_day)
  union all select 'gaps.quiet', count(*) from last_day, params p where last_day.day < (p.range_end - p.quiet)::date
  union all select 'gaps.untouched_counties', count(*) from (
              select state, county from sch group by state, county
              having count(*) filter (where id in (select school_id from last_day)) = 0) c
  union all select 'gaps.county.' || state || '|' || county || '.contacted',
                   count(*) filter (where id in (select school_id from last_day)) from sch group by state, county
  union all select 'health.verified_recent', count(*) from con_l, params p
            where verified_day >= (p.range_end - p.verified_recent)::date and verified_day <= p.range_end
  union all select 'health.verified_older', count(*) from con_l, params p
            where verified_day < (p.range_end - p.verified_recent)::date
  union all select 'health.never_verified', count(*) from con_l where verified_day is null
  union all select 'health.scraped_contacts', count(*) from con_l where scraped
  union all select 'health.no_county', count(*) from sch where county = '(no county)'
  union all select 'health.site.' || st.status, count(sch.id)
            from (values ('working'), ('broken'), ('not_found'), ('unchecked')) st(status)
            left join sch on coalesce(sch.source_status, 'unchecked') = st.status group by st.status
)
select jsonb_pretty(jsonb_object_agg(k, v)) as report_figures from figures;
