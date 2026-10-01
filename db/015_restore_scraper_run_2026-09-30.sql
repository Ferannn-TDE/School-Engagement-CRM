-- 015 — Undo the old scraper's run of 2026-09-30 19:48 UTC (WRITTEN, NOT YET APPLIED)
--
-- Why: someone ran the scraper from main (the old code, before scraper-fixes) against
-- the live database. Matching people by job title, replacing notes and using the
-- school's address as an event location, it rewrote 168 staff values and 20 event
-- locations, e.g. one person's email replaced by a colleague's, principals relabelled
-- "Administrator", scores in notes replaced.
--
-- What this does:
--   1. Saves every affected value as it is now AND as it was before the run in
--      backup.scraper_run_20260930 (a schema the app and the API can't reach).
--   2. Refuses to go on, changing nothing, if any of those values is no longer what
--      the run wrote (someone or something changed it since): no newer edit is ever
--      overwritten.
--   3. Puts the 188 values back to what they were before the run.
-- Kept as the run left them: the new school (IL:601054280303011), its staff member
-- (4380, Tresa D Dunbar) and the new event "D128 Financial Aid Webinar" (1114), which
-- may be real; and updated_at, which only records that the run touched a row.
--
-- Locks: run in the SQL Editor (no sign-in claims), so the db/006 trigger takes the
-- scraper path. No field was locked on 2026-09-30, so every value is written and no
-- field gets locked. (If a field gets locked before this runs, the trigger keeps the
-- client's value and parks this one in pending_scraped; the check in step 2 would
-- normally stop the run first.)
--
-- Values: "before" from ~/Desktop/CRM-db-exports/2026-09-29-phase5-step4b-after/
-- (staff) and 2026-09-29-phase5-step7-after/ (events); "after" from
-- 2026-09-30-phase5-step5-before/ and 2026-09-30-readonly-check/ (both taken after
-- the run, identical to the live data at the time). The full list is also in
-- 2026-09-30-scraper-run-1948utc-staff-changes.csv.
--
-- APPLY ONLY after the scraper workflow is disabled (or runs the fixed code):
-- otherwise the next run of the old scraper writes the same values again.
--
-- UNDO: update each value back to backup.scraper_run_20260930.value_after_run.

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.scraper_run_20260930 (
  tbl text not null,
  row_key text not null,
  col text not null,
  value_before_run jsonb,
  value_after_run jsonb,
  saved_at timestamptz not null default now(),
  primary key (tbl, row_key, col)
);
alter table backup.scraper_run_20260930 enable row level security;
revoke all on backup.scraper_run_20260930 from public, anon, authenticated;

insert into backup.scraper_run_20260930 (tbl, row_key, col, value_before_run, value_after_run) values
  ('staff', '116', 'job_name', to_jsonb('Principal'::text), to_jsonb('Administrator'::text)),
  ('staff', '116', 'notes', to_jsonb('7.96'::text), to_jsonb('4.8'::text)),
  ('staff', '116', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '145', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '148', 'job_name', to_jsonb('Principal 9-12'::text), to_jsonb('Administrator'::text)),
  ('staff', '148', 'notes', to_jsonb('8.28'::text), to_jsonb('4.8'::text)),
  ('staff', '148', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '149', 'email', to_jsonb('robertk@rps205.com'::text), to_jsonb('nielses@rps205.com'::text)),
  ('staff', '149', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '150', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '151', 'job_name', to_jsonb('Principal 9-12'::text), to_jsonb('Administrator'::text)),
  ('staff', '151', 'notes', to_jsonb('8.28'::text), to_jsonb('4.8'::text)),
  ('staff', '151', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '262', 'job_name', to_jsonb('Associate Principal for Operations'::text), to_jsonb('Principal'::text)),
  ('staff', '473', 'job_name', to_jsonb('High School / MS Principal'::text), to_jsonb('High School / ms principal'::text)),
  ('staff', '591', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '729', 'phone', to_jsonb('773-252-0970'::text), to_jsonb('773-486-6303'::text)),
  ('staff', '848', 'phone', to_jsonb('773-657-4020'::text), to_jsonb('773-977-4076'::text)),
  ('staff', '855', 'phone', to_jsonb('773-941-6674'::text), to_jsonb('773-553-1530'::text)),
  ('staff', '856', 'phone', to_jsonb('773-804-8866'::text), to_jsonb('773-553-1530'::text)),
  ('staff', '1016', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '1019', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '1021', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '1251', 'job_name', to_jsonb('Dean of Students-High School'::text), to_jsonb('Dean Of Students-High School'::text)),
  ('staff', '1256', 'job_name', to_jsonb('Dean of Students-High School'::text), to_jsonb('Dean Of Students-High School'::text)),
  ('staff', '1259', 'job_name', to_jsonb('Dean of Students-High School'::text), to_jsonb('Dean Of Students-High School'::text)),
  ('staff', '1361', 'job_name', to_jsonb('AAHS Principal'::text), to_jsonb('Administrator'::text)),
  ('staff', '1361', 'notes', to_jsonb('8.17'::text), to_jsonb('4.8'::text)),
  ('staff', '1361', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '1367', 'notes', to_jsonb('8.54'::text), to_jsonb('7.96'::text)),
  ('staff', '1369', 'notes', to_jsonb('8.54'::text), to_jsonb('7.96'::text)),
  ('staff', '1370', 'notes', to_jsonb('8.54'::text), to_jsonb('7.96'::text)),
  ('staff', '1382', 'email', to_jsonb('dw_attendance@d103.org'::text), to_jsonb('nbarba@d103.org'::text)),
  ('staff', '1382', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1424', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1430', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1576', 'phone', to_jsonb('618-254-4355'::text), to_jsonb('618-254-0607'::text)),
  ('staff', '1576', 'notes', to_jsonb('8.54'::text), to_jsonb('8.28'::text)),
  ('staff', '1657', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '1660', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '1703', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '1703', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1711', 'notes', to_jsonb('7.96'::text), to_jsonb('8.54'::text)),
  ('staff', '1712', 'notes', to_jsonb('7.96'::text), to_jsonb('8.54'::text)),
  ('staff', '1713', 'notes', to_jsonb('7.96'::text), to_jsonb('8.54'::text)),
  ('staff', '1714', 'notes', to_jsonb('8.3'::text), to_jsonb('8.54'::text)),
  ('staff', '1715', 'notes', to_jsonb('7.96'::text), to_jsonb('8.54'::text)),
  ('staff', '1717', 'job_name', to_jsonb('School Counselor'::text), to_jsonb('College and Career Coordinator'::text)),
  ('staff', '1717', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1720', 'notes', to_jsonb('7.96'::text), to_jsonb('8.54'::text)),
  ('staff', '1724', 'job_name', to_jsonb('School Social Worker'::text), to_jsonb('Social Worker'::text)),
  ('staff', '1724', 'school_worked_at', to_jsonb('IL:490810410251005'::text), to_jsonb('IL:490810410251003'::text)),
  ('staff', '1835', 'phone', to_jsonb('309-543-3384'::text), to_jsonb('309-543-3384 ext. 365'::text)),
  ('staff', '1835', 'job_name', to_jsonb('JH Principal'::text), to_jsonb('Junior High Principal'::text)),
  ('staff', '1835', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '1835', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1881', 'job_name', to_jsonb('Principal'::text), to_jsonb('Administrator'::text)),
  ('staff', '1881', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '1881', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '1971', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1989', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1993', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '1997', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '1999', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2020', 'name', to_jsonb('Barbara Terry'::text), to_jsonb('Mrs. Barbara Terry'::text)),
  ('staff', '2020', 'phone', to_jsonb('660-686-2421'::text), to_jsonb('660-686-2851'::text)),
  ('staff', '2020', 'job_name', to_jsonb('PK-12 Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2020', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2020', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2041', 'name', to_jsonb('Mark Stefan'::text), to_jsonb('Mr. Mark Stefan'::text)),
  ('staff', '2041', 'job_name', to_jsonb('Principal PK-12, Title 1, Federal Programs, Core Data, and Title IX Coordinator'::text), to_jsonb('Principal'::text)),
  ('staff', '2041', 'notes', to_jsonb('8.3'::text), to_jsonb('4.8'::text)),
  ('staff', '2041', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2045', 'name', to_jsonb('Matt Davis'::text), to_jsonb('Mr. Matthew Davis'::text)),
  ('staff', '2045', 'notes', to_jsonb('8.05'::text), to_jsonb('4.8'::text)),
  ('staff', '2045', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2051', 'name', to_jsonb('Gwen Ford'::text), to_jsonb('Mr. Gwen Ford'::text)),
  ('staff', '2051', 'phone', to_jsonb('660-679-6121 ext. 255'::text), to_jsonb('660-679-6121'::text)),
  ('staff', '2051', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2051', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2062', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '2065', 'name', to_jsonb('Mr. Nathan Gordon'::text), to_jsonb('Nathan Gordon'::text)),
  ('staff', '2065', 'notes', to_jsonb('4.8'::text), to_jsonb('8.51'::text)),
  ('staff', '2065', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2074', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '2075', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '2075', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2076', 'notes', to_jsonb('8.05'::text), to_jsonb('8.3'::text)),
  ('staff', '2076', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2077', 'name', to_jsonb('Chantelle Schwope'::text), to_jsonb('Mrs. Chantelle Scwhope'::text)),
  ('staff', '2077', 'job_name', to_jsonb('7th-12th Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2077', 'notes', to_jsonb('8.05'::text), to_jsonb('4.8'::text)),
  ('staff', '2077', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2098', 'name', to_jsonb('James Oyler'::text), to_jsonb('Mr. James Oyler'::text)),
  ('staff', '2098', 'job_name', to_jsonb('JH/High School Principal'::text), to_jsonb('Guidance Counselor'::text)),
  ('staff', '2098', 'notes', to_jsonb('5.9'::text), to_jsonb('8.54'::text)),
  ('staff', '2098', 'data_source', to_jsonb('district_staff_card'::text), to_jsonb('staff_card'::text)),
  ('staff', '2132', 'name', to_jsonb('Drew Nier'::text), to_jsonb('Mr. Drew Nier'::text)),
  ('staff', '2132', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2132', 'school_worked_at', to_jsonb('MO:017125-1100'::text), to_jsonb('MO:017125-1050'::text)),
  ('staff', '2132', 'notes', to_jsonb('8.05'::text), to_jsonb('4.8'::text)),
  ('staff', '2132', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2220', 'name', to_jsonb('Andy McNeely'::text), to_jsonb('Mr. Andrew McNeely'::text)),
  ('staff', '2220', 'notes', to_jsonb('8.3'::text), to_jsonb('4.8'::text)),
  ('staff', '2220', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2259', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '2262', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '2263', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '2265', 'name', to_jsonb('Mr. Brad Griffin'::text), to_jsonb('Brad Griffin'::text)),
  ('staff', '2265', 'job_name', to_jsonb('K-12 Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2265', 'notes', to_jsonb('4.8'::text), to_jsonb('8.05'::text)),
  ('staff', '2265', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2282', 'name', to_jsonb('Ben Nelson'::text), to_jsonb('Mr. Nelson Ben'::text)),
  ('staff', '2282', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2282', 'notes', to_jsonb('8.3'::text), to_jsonb('4.8'::text)),
  ('staff', '2282', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2307', 'job_name', to_jsonb('School Counselor'::text), to_jsonb('Freshman/Sophomore Counselor'::text)),
  ('staff', '2307', 'notes', to_jsonb('8.75'::text), to_jsonb('8.05'::text)),
  ('staff', '2307', 'data_source', to_jsonb('staff_card'::text), to_jsonb('repeated_staff_card'::text)),
  ('staff', '2348', 'name', to_jsonb('Jason Slaughter'::text), to_jsonb('Mr. Jason Slaughter'::text)),
  ('staff', '2348', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2348', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2374', 'name', to_jsonb('John Daniels'::text), to_jsonb('Mr. John Daniels'::text)),
  ('staff', '2374', 'phone', to_jsonb('417-934-5408'::text), to_jsonb('417-934-2020'::text)),
  ('staff', '2374', 'job_name', to_jsonb('LHS Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2374', 'notes', to_jsonb('8.28'::text), to_jsonb('4.8'::text)),
  ('staff', '2374', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2534', 'job_name', to_jsonb('District Social Worker/Homeless Liaison'::text), to_jsonb('District Social Worker - Foster Care, Homeless, Migrant District Liaison'::text)),
  ('staff', '2534', 'notes', to_jsonb('8.3'::text), to_jsonb('8.28'::text)),
  ('staff', '2564', 'name', to_jsonb('Dan Nagel'::text), to_jsonb('Mr. Dan Nagel'::text)),
  ('staff', '2564', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2564', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2638', 'name', to_jsonb('Carrie Livengood'::text), to_jsonb('Mrs. Carrie Livengood'::text)),
  ('staff', '2638', 'job_name', to_jsonb('High School Principal/Athletic Director'::text), to_jsonb('Principal'::text)),
  ('staff', '2638', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2638', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2647', 'name', to_jsonb('Marc Pitts'::text), to_jsonb('Mr. Marc Pitts'::text)),
  ('staff', '2647', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2647', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2647', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2656', 'name', to_jsonb('Elizabeth Martin'::text), to_jsonb('Mr. Elizabeth Martin'::text)),
  ('staff', '2656', 'phone', to_jsonb('417-261-2337'::text), to_jsonb('417-261-2263'::text)),
  ('staff', '2656', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '2656', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2656', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2672', 'data_source', to_jsonb('district_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2713', 'data_source', to_jsonb('district_staff_card'::text), to_jsonb('district_repeated_staff_card'::text)),
  ('staff', '2772', 'name', to_jsonb('Mr. Shane Schlueter'::text), to_jsonb('Dr. Shane Schlueter'::text)),
  ('staff', '2772', 'phone', to_jsonb('636-327-3876'::text), to_jsonb('636-327-3876 ext. 26224'::text)),
  ('staff', '2772', 'notes', to_jsonb('4.8'::text), to_jsonb('5.9'::text)),
  ('staff', '2772', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('district_staff_card'::text)),
  ('staff', '2837', 'name', to_jsonb('Ally Klein'::text), to_jsonb('Dr. Ally Klein'::text)),
  ('staff', '2837', 'phone', to_jsonb('573-883-4500 ext. 2103'::text), to_jsonb('573-883-4500'::text)),
  ('staff', '2837', 'notes', to_jsonb('8.54'::text), to_jsonb('4.8'::text)),
  ('staff', '2837', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '2933', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '2934', 'notes', to_jsonb('8.28'::text), to_jsonb('8.54'::text)),
  ('staff', '2994', 'name', to_jsonb('Jason Duey'::text), to_jsonb('Mr. Jason Duey'::text)),
  ('staff', '2994', 'notes', to_jsonb('8.05'::text), to_jsonb('4.8'::text)),
  ('staff', '2994', 'data_source', to_jsonb('repeated_staff_card'::text), to_jsonb('official_state_record'::text)),
  ('staff', '3008', 'name', to_jsonb('Dr. Tina Hamilton'::text), to_jsonb('Saint Louis University'::text)),
  ('staff', '3008', 'job_name', to_jsonb('Principal'::text), to_jsonb('Principal, K-12'::text)),
  ('staff', '3008', 'notes', to_jsonb('4.8'::text), to_jsonb('8.54'::text)),
  ('staff', '3008', 'data_source', to_jsonb('official_state_record'::text), to_jsonb('staff_card'::text)),
  ('staff', '3053', 'name', to_jsonb('Kyle Turner'::text), to_jsonb('Mr. Kyle Turner'::text)),
  ('staff', '3053', 'job_name', to_jsonb('High School Principal'::text), to_jsonb('Principal'::text)),
  ('staff', '3053', 'notes', to_jsonb('8.28'::text), to_jsonb('4.8'::text)),
  ('staff', '3053', 'data_source', to_jsonb('staff_card'::text), to_jsonb('official_state_record'::text)),
  ('events', '1', 'location', null, to_jsonb('17050 Clayton Road, Wildwood, MO 630111794'::text)),
  ('events', '2', 'location', null, to_jsonb('433 Vine Ave, Highland Park, IL 60035 2044'::text)),
  ('events', '5', 'location', to_jsonb('285 E Grand Ave, Fox Lake, Il 60020-1634'::text), to_jsonb('285 E Grand Ave, Fox Lake, IL 60020 1634'::text)),
  ('events', '8', 'location', null, to_jsonb('2275 Sommers Road, Lake St. Louis, MO 633676406'::text)),
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
  ('events', '49', 'location', null, to_jsonb('333 W McEvilly Rd, Minooka, IL 60447 8786'::text)),
  ('events', '57', 'location', null, to_jsonb('1600 Dodge Ave, Evanston, IL 60201 3449'::text)),
  ('events', '62', 'location', null, to_jsonb('2800 Seckman Road, Imperial, MO 630521941'::text));

-- Step 2: stop if anything changed since the run.
do $check$
declare changed int;
begin
  select count(*) into changed
    from backup.scraper_run_20260930 b
   where (b.tbl = 'staff' and (select to_jsonb(s) -> b.col from public.staff s where s.staff_id = b.row_key::int)
                               is distinct from coalesce(b.value_after_run, 'null'::jsonb))
      or (b.tbl = 'events' and (select to_jsonb(e) -> b.col from public.events e where e.event_id = b.row_key::int)
                               is distinct from coalesce(b.value_after_run, 'null'::jsonb));
  if changed > 0 then
    raise exception '% value(s) changed since the 19:48 UTC run; nothing was restored. Rebuild the restore list first.', changed;
  end if;
end $check$;

-- Step 3: the 188 values as they were before the run.
update public.staff set job_name = 'Principal' where staff_id = 116;
update public.staff set notes = '7.96' where staff_id = 116;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 116;
update public.staff set notes = '8.05' where staff_id = 145;
update public.staff set job_name = 'Principal 9-12' where staff_id = 148;
update public.staff set notes = '8.28' where staff_id = 148;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 148;
update public.staff set email = 'robertk@rps205.com' where staff_id = 149;
update public.staff set notes = '8.05' where staff_id = 149;
update public.staff set notes = '8.28' where staff_id = 150;
update public.staff set job_name = 'Principal 9-12' where staff_id = 151;
update public.staff set notes = '8.28' where staff_id = 151;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 151;
update public.staff set job_name = 'Associate Principal for Operations' where staff_id = 262;
update public.staff set job_name = 'High School / MS Principal' where staff_id = 473;
update public.staff set data_source = 'staff_card' where staff_id = 591;
update public.staff set phone = '773-252-0970' where staff_id = 729;
update public.staff set phone = '773-657-4020' where staff_id = 848;
update public.staff set phone = '773-941-6674' where staff_id = 855;
update public.staff set phone = '773-804-8866' where staff_id = 856;
update public.staff set notes = '8.05' where staff_id = 1016;
update public.staff set notes = '8.05' where staff_id = 1019;
update public.staff set notes = '8.05' where staff_id = 1021;
update public.staff set job_name = 'Dean of Students-High School' where staff_id = 1251;
update public.staff set job_name = 'Dean of Students-High School' where staff_id = 1256;
update public.staff set job_name = 'Dean of Students-High School' where staff_id = 1259;
update public.staff set job_name = 'AAHS Principal' where staff_id = 1361;
update public.staff set notes = '8.17' where staff_id = 1361;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1361;
update public.staff set notes = '8.54' where staff_id = 1367;
update public.staff set notes = '8.54' where staff_id = 1369;
update public.staff set notes = '8.54' where staff_id = 1370;
update public.staff set email = 'dw_attendance@d103.org' where staff_id = 1382;
update public.staff set data_source = 'staff_card' where staff_id = 1382;
update public.staff set data_source = 'staff_card' where staff_id = 1424;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1430;
update public.staff set phone = '618-254-4355' where staff_id = 1576;
update public.staff set notes = '8.54' where staff_id = 1576;
update public.staff set notes = '8.05' where staff_id = 1657;
update public.staff set notes = '8.05' where staff_id = 1660;
update public.staff set notes = '8.28' where staff_id = 1703;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1703;
update public.staff set notes = '7.96' where staff_id = 1711;
update public.staff set notes = '7.96' where staff_id = 1712;
update public.staff set notes = '7.96' where staff_id = 1713;
update public.staff set notes = '8.3' where staff_id = 1714;
update public.staff set notes = '7.96' where staff_id = 1715;
update public.staff set job_name = 'School Counselor' where staff_id = 1717;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1717;
update public.staff set notes = '7.96' where staff_id = 1720;
update public.staff set job_name = 'School Social Worker' where staff_id = 1724;
update public.staff set school_worked_at = 'IL:490810410251005' where staff_id = 1724;
update public.staff set phone = '309-543-3384' where staff_id = 1835;
update public.staff set job_name = 'JH Principal' where staff_id = 1835;
update public.staff set notes = '8.28' where staff_id = 1835;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1835;
update public.staff set job_name = 'Principal' where staff_id = 1881;
update public.staff set notes = '8.54' where staff_id = 1881;
update public.staff set data_source = 'staff_card' where staff_id = 1881;
update public.staff set data_source = 'staff_card' where staff_id = 1971;
update public.staff set data_source = 'staff_card' where staff_id = 1989;
update public.staff set data_source = 'staff_card' where staff_id = 1993;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 1997;
update public.staff set data_source = 'staff_card' where staff_id = 1999;
update public.staff set name = 'Barbara Terry' where staff_id = 2020;
update public.staff set phone = '660-686-2421' where staff_id = 2020;
update public.staff set job_name = 'PK-12 Principal' where staff_id = 2020;
update public.staff set notes = '8.54' where staff_id = 2020;
update public.staff set data_source = 'staff_card' where staff_id = 2020;
update public.staff set name = 'Mark Stefan' where staff_id = 2041;
update public.staff set job_name = 'Principal PK-12, Title 1, Federal Programs, Core Data, and Title IX Coordinator' where staff_id = 2041;
update public.staff set notes = '8.3' where staff_id = 2041;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2041;
update public.staff set name = 'Matt Davis' where staff_id = 2045;
update public.staff set notes = '8.05' where staff_id = 2045;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2045;
update public.staff set name = 'Gwen Ford' where staff_id = 2051;
update public.staff set phone = '660-679-6121 ext. 255' where staff_id = 2051;
update public.staff set notes = '8.54' where staff_id = 2051;
update public.staff set data_source = 'staff_card' where staff_id = 2051;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2062;
update public.staff set name = 'Mr. Nathan Gordon' where staff_id = 2065;
update public.staff set notes = '4.8' where staff_id = 2065;
update public.staff set data_source = 'official_state_record' where staff_id = 2065;
update public.staff set notes = '8.05' where staff_id = 2074;
update public.staff set notes = '8.05' where staff_id = 2075;
update public.staff set data_source = 'staff_card' where staff_id = 2075;
update public.staff set notes = '8.05' where staff_id = 2076;
update public.staff set data_source = 'staff_card' where staff_id = 2076;
update public.staff set name = 'Chantelle Schwope' where staff_id = 2077;
update public.staff set job_name = '7th-12th Principal' where staff_id = 2077;
update public.staff set notes = '8.05' where staff_id = 2077;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2077;
update public.staff set name = 'James Oyler' where staff_id = 2098;
update public.staff set job_name = 'JH/High School Principal' where staff_id = 2098;
update public.staff set notes = '5.9' where staff_id = 2098;
update public.staff set data_source = 'district_staff_card' where staff_id = 2098;
update public.staff set name = 'Drew Nier' where staff_id = 2132;
update public.staff set job_name = 'High School Principal' where staff_id = 2132;
update public.staff set school_worked_at = 'MO:017125-1100' where staff_id = 2132;
update public.staff set notes = '8.05' where staff_id = 2132;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2132;
update public.staff set name = 'Andy McNeely' where staff_id = 2220;
update public.staff set notes = '8.3' where staff_id = 2220;
update public.staff set data_source = 'staff_card' where staff_id = 2220;
update public.staff set notes = '8.28' where staff_id = 2259;
update public.staff set notes = '8.28' where staff_id = 2262;
update public.staff set notes = '8.28' where staff_id = 2263;
update public.staff set name = 'Mr. Brad Griffin' where staff_id = 2265;
update public.staff set job_name = 'K-12 Principal' where staff_id = 2265;
update public.staff set notes = '4.8' where staff_id = 2265;
update public.staff set data_source = 'official_state_record' where staff_id = 2265;
update public.staff set name = 'Ben Nelson' where staff_id = 2282;
update public.staff set job_name = 'High School Principal' where staff_id = 2282;
update public.staff set notes = '8.3' where staff_id = 2282;
update public.staff set data_source = 'staff_card' where staff_id = 2282;
update public.staff set job_name = 'School Counselor' where staff_id = 2307;
update public.staff set notes = '8.75' where staff_id = 2307;
update public.staff set data_source = 'staff_card' where staff_id = 2307;
update public.staff set name = 'Jason Slaughter' where staff_id = 2348;
update public.staff set notes = '8.54' where staff_id = 2348;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2348;
update public.staff set name = 'John Daniels' where staff_id = 2374;
update public.staff set phone = '417-934-5408' where staff_id = 2374;
update public.staff set job_name = 'LHS Principal' where staff_id = 2374;
update public.staff set notes = '8.28' where staff_id = 2374;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2374;
update public.staff set job_name = 'District Social Worker/Homeless Liaison' where staff_id = 2534;
update public.staff set notes = '8.3' where staff_id = 2534;
update public.staff set name = 'Dan Nagel' where staff_id = 2564;
update public.staff set notes = '8.54' where staff_id = 2564;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2564;
update public.staff set name = 'Carrie Livengood' where staff_id = 2638;
update public.staff set job_name = 'High School Principal/Athletic Director' where staff_id = 2638;
update public.staff set notes = '8.54' where staff_id = 2638;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2638;
update public.staff set name = 'Marc Pitts' where staff_id = 2647;
update public.staff set job_name = 'High School Principal' where staff_id = 2647;
update public.staff set notes = '8.54' where staff_id = 2647;
update public.staff set data_source = 'staff_card' where staff_id = 2647;
update public.staff set name = 'Elizabeth Martin' where staff_id = 2656;
update public.staff set phone = '417-261-2337' where staff_id = 2656;
update public.staff set job_name = 'High School Principal' where staff_id = 2656;
update public.staff set notes = '8.54' where staff_id = 2656;
update public.staff set data_source = 'staff_card' where staff_id = 2656;
update public.staff set data_source = 'district_staff_card' where staff_id = 2672;
update public.staff set data_source = 'district_staff_card' where staff_id = 2713;
update public.staff set name = 'Mr. Shane Schlueter' where staff_id = 2772;
update public.staff set phone = '636-327-3876' where staff_id = 2772;
update public.staff set notes = '4.8' where staff_id = 2772;
update public.staff set data_source = 'official_state_record' where staff_id = 2772;
update public.staff set name = 'Ally Klein' where staff_id = 2837;
update public.staff set phone = '573-883-4500 ext. 2103' where staff_id = 2837;
update public.staff set notes = '8.54' where staff_id = 2837;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2837;
update public.staff set notes = '8.28' where staff_id = 2933;
update public.staff set notes = '8.28' where staff_id = 2934;
update public.staff set name = 'Jason Duey' where staff_id = 2994;
update public.staff set notes = '8.05' where staff_id = 2994;
update public.staff set data_source = 'repeated_staff_card' where staff_id = 2994;
update public.staff set name = 'Dr. Tina Hamilton' where staff_id = 3008;
update public.staff set job_name = 'Principal' where staff_id = 3008;
update public.staff set notes = '4.8' where staff_id = 3008;
update public.staff set data_source = 'official_state_record' where staff_id = 3008;
update public.staff set name = 'Kyle Turner' where staff_id = 3053;
update public.staff set job_name = 'High School Principal' where staff_id = 3053;
update public.staff set notes = '8.28' where staff_id = 3053;
update public.staff set data_source = 'staff_card' where staff_id = 3053;
update public.events set location = null where event_id = 1;
update public.events set location = null where event_id = 2;
update public.events set location = '285 E Grand Ave, Fox Lake, Il 60020-1634' where event_id = 5;
update public.events set location = null where event_id = 8;
update public.events set location = null where event_id = 13;
update public.events set location = null where event_id = 14;
update public.events set location = null where event_id = 15;
update public.events set location = null where event_id = 16;
update public.events set location = null where event_id = 17;
update public.events set location = null where event_id = 19;
update public.events set location = null where event_id = 22;
update public.events set location = null where event_id = 29;
update public.events set location = null where event_id = 30;
update public.events set location = null where event_id = 33;
update public.events set location = null where event_id = 34;
update public.events set location = null where event_id = 35;
update public.events set location = null where event_id = 40;
update public.events set location = null where event_id = 49;
update public.events set location = null where event_id = 57;
update public.events set location = null where event_id = 62;

commit;

-- Review: expect 188 rows in the backup, and 0 values that differ from value_before_run.
--   select count(*) from backup.scraper_run_20260930;
--   select count(*) from backup.scraper_run_20260930 b
--    where (b.tbl = 'staff' and (select to_jsonb(s) -> b.col from public.staff s where s.staff_id = b.row_key::int) is distinct from coalesce(b.value_before_run, 'null'::jsonb))
--       or (b.tbl = 'events' and (select to_jsonb(e) -> b.col from public.events e where e.event_id = b.row_key::int) is distinct from coalesce(b.value_before_run, 'null'::jsonb));
