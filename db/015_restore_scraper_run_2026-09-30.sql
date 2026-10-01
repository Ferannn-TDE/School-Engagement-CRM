-- 015 — Undo the old scraper's runs of 2026-09-30 19:48 UTC and 2026-10-01 03:13 UTC
--
-- Why: the scraper from main (the old code, before scraper-fixes) was run twice
-- against the live database. Matching people by job title, replacing notes and using
-- the school's address as an event location, it rewrote staff values and event
-- locations, e.g. one person's email replaced by a colleague's, principals relabelled
-- "Administrator", scores in notes replaced. The second run (workflow run #5) undid
-- some of the first run's changes and made others.
--
-- Target: the data as it was before the first run, i.e. the snapshots of 2026-09-29
-- (~/Desktop/CRM-db-exports/2026-09-29-phase5-step4b-after/ for staff,
-- 2026-09-29-phase5-step7-after/ for events). Compared with the data after both runs
-- (2026-10-01-after-run5/), 117 staff values and 22 event locations differ; this
-- puts exactly those back.
--
-- What this does:
--   1. Saves every affected value as it is now AND as it was before the runs in
--      backup.scraper_runs_20260930_20261001 (a schema the app and the API can't reach).
--   2. Refuses to go on, changing nothing, if any of those values is no longer what
--      the runs left (something changed it since): no newer edit is ever overwritten.
--   3. Puts the 139 values back.
-- Kept as the runs left them: rows that are new since 2026-09-29 (1 school, 109 staff,
-- 38 events), which may be real; and updated_at. Nine of the new staff have the same
-- name as someone already at the same school (likely duplicates from job-title
-- matching); deciding about them is separate and nothing here changes them.
--
-- Locks: run in the SQL Editor (no sign-in claims), so the db/006/012 trigger takes
-- the scraper path. No field was locked on 2026-10-01, so every value is written and
-- no field gets locked.
--
-- UNDO: update each value back to backup.scraper_runs_20260930_20261001.value_after_runs.

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.scraper_runs_20260930_20261001 (
  tbl text not null,
  row_key text not null,
  col text not null,
  value_before_runs jsonb,
  value_after_runs jsonb,
  saved_at timestamptz not null default now(),
  primary key (tbl, row_key, col)
);
alter table backup.scraper_runs_20260930_20261001 enable row level security;
revoke all on backup.scraper_runs_20260930_20261001 from public, anon, authenticated;

insert into backup.scraper_runs_20260930_20261001 (tbl, row_key, col, value_before_runs, value_after_runs) values
  ('staff', '19', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '136', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '408', 'job_name', to_jsonb('School Counselor/Asesora Escolar (Ran-Ry and ELL)'::text), to_jsonb('School Counselor/Asesora Escolar (Ramos-Ruv and ELL A-R)'::text)),
  ('staff', '464', 'phone', to_jsonb('815-273-7715'::text), to_jsonb('815-244-2005'::text)),
  ('staff', '529', 'phone', to_jsonb('217-923-3133'::text), to_jsonb('217-923-3132'::text)),
  ('staff', '729', 'phone', to_jsonb('773-252-0970'::text), to_jsonb('773-486-6303'::text)),
  ('staff', '1050', 'phone', to_jsonb('618-847-9403'::text), to_jsonb('618-842-2649'::text)),
  ('staff', '1108', 'job_name', to_jsonb('School Social Worker/ SADD Sponsor'::text), to_jsonb('School Social Worker/ SADD Sponsor/Class of 2028 Sponsor'::text)),
  ('staff', '1249', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1427', 'phone', to_jsonb('847-986-3300'::text), to_jsonb('847-986-3300 ext. 5751'::text)),
  ('staff', '1435', 'phone', to_jsonb('847-986-3300'::text), to_jsonb('847-986-3300 ext. 5520'::text)),
  ('staff', '1548', 'job_name', to_jsonb('Social Worker'::text), to_jsonb('Principal - Success Center'::text)),
  ('staff', '1719', 'notes', to_jsonb('8.54'::text), to_jsonb('7.96'::text)),
  ('staff', '1726', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1835', 'phone', to_jsonb('309-543-3384'::text), to_jsonb('309-543-3384 ext. 365'::text)),
  ('staff', '1835', 'job_name', to_jsonb('JH Principal'::text), to_jsonb('Junior High Principal'::text)),
  ('staff', '1835', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '1835', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1905', 'name', to_jsonb('Panda Kagels'::text), to_jsonb('Rhonda Mauk'::text)),
  ('staff', '2011', 'phone', to_jsonb('309-438-8542'::text), to_jsonb('309-438-8346'::text)),
  ('staff', '2043', 'name', to_jsonb('Ms. Stephanie Nold'::text), to_jsonb('Mrs. Stephanie Nold'::text)),
  ('staff', '2044', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2045', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '2065', 'name', to_jsonb('Mr. Nathan Gordon'::text), to_jsonb('Nathan Gordon'::text)),
  ('staff', '2065', 'notes', to_jsonb('4.8'::text), to_jsonb('8.51'::text)),
  ('staff', '2065', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2072', 'email', to_jsonb('ebuechler@cpsk12.org'::text), to_jsonb('bmcandrew@cpsk12.org'::text)),
  ('staff', '2072', 'job_name', to_jsonb('CACC Sending School Counselor'::text), to_jsonb('CACC School Counselor'::text)),
  ('staff', '2115', 'name', to_jsonb('Morgan Perez'::text), to_jsonb('Mrs. Morgan Perez'::text)),
  ('staff', '2115', 'phone', null, to_jsonb('573-590-8100'::text)),
  ('staff', '2115', 'notes', to_jsonb('8.3'::text), to_jsonb('4.8'::text)),
  ('staff', '2115', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2231', 'job_name', to_jsonb('Assistant Principal/Athletic Director'::text), to_jsonb('High School Principal'::text)),
  ('staff', '2231', 'notes', to_jsonb('8.54'::text), to_jsonb('8.75'::text)),
  ('staff', '2231', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '2243', 'name', to_jsonb('Scholarship Oppurtunities'::text), to_jsonb('Scholarship Opportunities'::text)),
  ('staff', '2255', 'name', to_jsonb('Mrs. Donovan Harris'::text), to_jsonb('Mr. Donovan Harris'::text)),
  ('staff', '2259', 'notes', to_jsonb('8.28'::text), to_jsonb('5.9'::text)),
  ('staff', '2259', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2260', 'notes', to_jsonb('8.28'::text), to_jsonb('5.9'::text)),
  ('staff', '2260', 'data_source', to_jsonb('staff_card'::text), to_jsonb('district_staff_card'::text)),
  ('staff', '2262', 'notes', to_jsonb('8.28'::text), to_jsonb('5.9'::text)),
  ('staff', '2262', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2263', 'notes', to_jsonb('8.28'::text), to_jsonb('5.9'::text)),
  ('staff', '2263', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2441', 'name', to_jsonb('Mark Wiegers'::text), to_jsonb('Mr. Mark Wiegers'::text)),
  ('staff', '2441', 'phone', null, to_jsonb('816-349-3330'::text)),
  ('staff', '2441', 'notes', to_jsonb('8.05'::text), to_jsonb('4.8'::text)),
  ('staff', '2441', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2452', 'name', to_jsonb('Ms. Erin Wilmore'::text), to_jsonb('Erin Wilmore'::text)),
  ('staff', '2452', 'job_name', to_jsonb('Principal'::text), to_jsonb('Building Principal'::text)),
  ('staff', '2452', 'notes', to_jsonb('4.8'::text), to_jsonb('8.3'::text)),
  ('staff', '2452', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('staff_card'::text)),
  ('staff', '2696', 'email', to_jsonb('hochardk@parkhill.k12.mo.us'::text), to_jsonb('rodriguezel@parkhill.k12.mo.us'::text)),
  ('staff', '2713', 'data_source', to_jsonb('district_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2811', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '2819', 'name', to_jsonb('Dustin Schubert'::text), to_jsonb('Mr. Dustin Schubert'::text)),
  ('staff', '2819', 'phone', null, to_jsonb('417-646-8144'::text)),
  ('staff', '2819', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2819', 'notes', to_jsonb('5.9'::text), to_jsonb('4.8'::text)),
  ('staff', '2819', 'data_source', to_jsonb('district_repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2868', 'email', to_jsonb('smithb@msdr9.org'::text), to_jsonb('schwaegelt@msdr9.org'::text)),
  ('staff', '2919', 'name', to_jsonb('Welcome To North Tech'::text), to_jsonb('Visiting North Tech'::text)),
  ('staff', '2923', 'name', to_jsonb('Welcome To South Tech'::text), to_jsonb('Visiting South Tech'::text)),
  ('staff', '3149', 'notes', to_jsonb('7.96'::text), to_jsonb('8.17'::text)),
  ('staff', '3413', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3465', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3471', 'phone', to_jsonb('708-679-3120'::text), to_jsonb('708-679-3102'::text)),
  ('staff', '3478', 'phone', null, to_jsonb('708-679-5644'::text)),
  ('staff', '3478', 'notes', to_jsonb('8.3'::text), to_jsonb('8.54'::text)),
  ('staff', '3537', 'job_name', to_jsonb('BRHS Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '3551', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3559', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3561', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3592', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3612', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3670', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3672', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3677', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3681', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3686', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3689', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3699', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3701', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3704', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3706', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3708', 'job_name', to_jsonb('Principal-Dream Acad'::text), to_jsonb('Sub-High School Principal'::text)),
  ('staff', '3709', 'job_name', to_jsonb('Associate Principal-High School'::text), to_jsonb('Principal-Dream Acad'::text)),
  ('staff', '3795', 'phone', to_jsonb('847-986-3300'::text), to_jsonb('847-986-3300 ext. 5738'::text)),
  ('staff', '3796', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3797', 'phone', to_jsonb('847-986-3300'::text), to_jsonb('847-986-3300 ext. 5727'::text)),
  ('staff', '3811', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3817', 'notes', to_jsonb('8.54'::text), to_jsonb('8.28'::text)),
  ('staff', '3820', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3884', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3991', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3996', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '3997', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '3998', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '4080', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '4100', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '4179', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '4180', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '4181', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '4182', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '4183', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '4184', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '4184', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '4226', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '4247', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '4254', 'school_worked_at', to_jsonb('MO:048080-1050'::text), to_jsonb('MO:048080-1020'::text)),
  ('staff', '4258', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '4261', 'school_worked_at', to_jsonb('MO:048080-1050'::text), to_jsonb('MO:048080-1020'::text)),
  ('staff', '4261', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '4332', 'job_name', to_jsonb('Assistant Principal'::text), to_jsonb('Assiatant Principal'::text)),
  ('staff', '4343', 'notes', to_jsonb('7.7'::text), to_jsonb('7.96'::text)),
  ('staff', '4347', 'job_name', to_jsonb('Senior Counselor and College and Career Counselor'::text), to_jsonb('College and Career Counselor'::text)),
  ('events', '1', 'location', null, to_jsonb('17050 Clayton Road, Wildwood, MO 630111794'::text)),
  ('events', '2', 'location', null, to_jsonb('433 Vine Ave, Highland Park, IL 60035 2044'::text)),
  ('events', '5', 'location', to_jsonb('285 E Grand Ave, Fox Lake, Il 60020-1634'::text), to_jsonb('285 E Grand Ave, Fox Lake, IL 60020 1634'::text)),
  ('events', '8', 'location', null, to_jsonb('2275 Sommers Road, Lake St. Louis, MO 633676406'::text)),
  ('events', '10', 'location', null, to_jsonb('9800 Lawler Ave, Skokie, IL 60077 1215'::text)),
  ('events', '13', 'location', null, to_jsonb('365 Raider Way, Bolingbrook, IL 60440 4893'::text)),
  ('events', '14', 'location', null, to_jsonb('34090 N Almond Rd, Gurnee, IL 60031 5310'::text)),
  ('events', '15', 'location', null, to_jsonb('1959 Waukegan Rd, Deerfield, IL 60015 1840'::text)),
  ('events', '16', 'location', null, to_jsonb('559 E Highway N, Wentzville, MO 633855906'::text)),
  ('events', '17', 'location', null, to_jsonb('2255 West Meyer Road, Wentzville, MO 633853323'::text)),
  ('events', '19', 'location', null, to_jsonb('2275 Sommers Road, Lake St. Louis, MO 633676406'::text)),
  ('events', '22', 'location', null, to_jsonb('1100 Keokuk St, Hamilton, IL 62341 1049'::text)),
  ('events', '29', 'location', null, to_jsonb('4525 Highway 109, Eureka, MO 630251222'::text)),
  ('events', '30', 'location', null, to_jsonb('100 S Brainard Ave, La Grange, IL 60525 2101'::text)),
  ('events', '33', 'location', null, to_jsonb('333 W McEvilly Rd, Minooka, IL 60447 8786'::text)),
  ('events', '34', 'location', null, to_jsonb('1780 Hawkins Road, Fenton, MO 630262650'::text)),
  ('events', '35', 'location', null, to_jsonb('2255 West Meyer Road, Wentzville, MO 633853323'::text)),
  ('events', '40', 'location', null, to_jsonb('14653 Clayton Road, Ballwin, MO 630112656'::text)),
  ('events', '47', 'location', null, to_jsonb('514 South Nicholas Road, Nixa, MO 657148663'::text)),
  ('events', '49', 'location', null, to_jsonb('333 W McEvilly Rd, Minooka, IL 60447 8786'::text)),
  ('events', '57', 'location', null, to_jsonb('1600 Dodge Ave, Evanston, IL 60201 3449'::text)),
  ('events', '62', 'location', null, to_jsonb('2800 Seckman Road, Imperial, MO 630521941'::text));

-- Step 2: stop if anything changed since the runs.
do $check$
declare changed int;
begin
  select count(*) into changed
    from backup.scraper_runs_20260930_20261001 b
   where (b.tbl = 'staff' and (select to_jsonb(s) -> b.col from public.staff s where s.staff_id = b.row_key::int)
                               is distinct from coalesce(b.value_after_runs, 'null'::jsonb))
      or (b.tbl = 'events' and (select to_jsonb(e) -> b.col from public.events e where e.event_id = b.row_key::int)
                               is distinct from coalesce(b.value_after_runs, 'null'::jsonb));
  if changed > 0 then
    raise exception '% value(s) changed since the scraper runs; nothing was restored. Rebuild the restore list first.', changed;
  end if;
end $check$;

-- Step 3: the 139 values as they were before the runs, taken from the backup table
-- just filled in, so what is restored is exactly what was saved.
update public.staff s set data_source = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'data_source' and s.staff_id = b.row_key::int;
update public.staff s set job_name = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'job_name' and s.staff_id = b.row_key::int;
update public.staff s set phone = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'phone' and s.staff_id = b.row_key::int;
update public.staff s set notes = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'notes' and s.staff_id = b.row_key::int;
update public.staff s set name = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'name' and s.staff_id = b.row_key::int;
update public.staff s set email = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'email' and s.staff_id = b.row_key::int;
update public.staff s set school_worked_at = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'staff' and b.col = 'school_worked_at' and s.staff_id = b.row_key::int;
update public.events e set location = b.value_before_runs #>> '{}' from backup.scraper_runs_20260930_20261001 b where b.tbl = 'events' and b.col = 'location' and e.event_id = b.row_key::int;

do $count$
declare n int;
begin
  select count(*) into n from backup.scraper_runs_20260930_20261001;
  if n <> 139 then
    raise exception 'Expected 139 values in the backup, found %; nothing was restored.', n;
  end if;
end $count$;

commit;

-- Review: expect 139 rows in the backup, and 0 values that differ from value_before_runs.
--   select count(*) from backup.scraper_runs_20260930_20261001 b
--    where (b.tbl = 'staff' and (select to_jsonb(s) -> b.col from public.staff s where s.staff_id = b.row_key::int) is distinct from coalesce(b.value_before_runs, 'null'::jsonb))
--       or (b.tbl = 'events' and (select to_jsonb(e) -> b.col from public.events e where e.event_id = b.row_key::int) is distinct from coalesce(b.value_before_runs, 'null'::jsonb));
