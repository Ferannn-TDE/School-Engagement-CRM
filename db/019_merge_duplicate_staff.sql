-- 019 — Merge 6 duplicate staff records left by the old scraper's run of 2026-10-01
--
-- Why: workflow run #5 (old scraper, 2026-10-01 03:13 UTC) added a second record for
-- people already on file at the same school. Three that added nothing were archived on
-- 2026-10-01 (#4385, #4392, #4442). These six carry something the existing record lacks,
-- so they are merged into it, as decided 2026-10-01:
--   * a field the existing record has blank is filled from the new one, locking nothing;
--   * where the two disagree, the existing value stays and the new one is put in
--     pending_scraped, with that one field locked, so the school page's "Updates from
--     the website" card asks "keep yours or use this?" (Use this applies it and unlocks);
--   * the new record is archived with a note naming the record it was merged into.
--
--   kept   new    filled in (no lock)               waiting for review (field locked)
--   #455   #4394  email lmay@olchs.org              phone 708-741-5652 (has 708-424-5200)
--   #1730  #4445  phone 309-793-5924                -
--   #1919  #4446  phone 815-836-2724                -
--   #862   #4405  -                                 title "High School Principal"
--   #1233  #4413  -                                 title "Jr. High/ High School Principal"
--   #4375  #4487  -                                 phone 660-265-4414 ext. 1402 (has ext. 1406)
-- Other differences keep the existing value without a question (e.g. #455's title
-- "Administrator" vs the new "Principal"; #1730 and #1919 have the fuller titles).
--
-- Safety: the 12 rows are saved first in backup.duplicate_merge_20261001, and nothing
-- changes if any of them differs from what is listed here.
-- Snapshot (outside the repo): ~/Desktop/CRM-db-exports/2026-10-01-merge-before/
-- UNDO: restore the 12 rows' columns from backup.duplicate_merge_20261001.row.

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.duplicate_merge_20261001 as
select staff_id, to_jsonb(s) as row, now() as saved_at
  from public.staff s
 where staff_id in (455, 4394, 1730, 4445, 1919, 4446, 862, 4405, 1233, 4413, 4375, 4487);
alter table backup.duplicate_merge_20261001 add primary key (staff_id);
alter table backup.duplicate_merge_20261001 enable row level security;
revoke all on backup.duplicate_merge_20261001 from public, anon, authenticated;

do $check$
declare bad int;
begin
  select count(*) into bad from (values
    (455,  null::text, '708-424-5200', 'Administrator'),
    (4394, 'lmay@olchs.org', '708-741-5652', 'Principal'),
    (1730, 'timothy.wernentin@rimsd41.org', null, 'Administrator In Charge'),
    (4445, null, '309-793-5924', 'Administrator'),
    (1919, 'jbillingsley@d92.org', null, 'Principal'),
    (4446, null, '815-836-2724', 'Administrator'),
    (862,  null, '815-824-2197', 'Administrator'),
    (4405, null, '815-824-2197', 'High School Principal'),
    (1233, null, '618-342-6778', 'Administrator'),
    (4413, null, '618-342-6778', 'Jr. High/ High School Principal'),
    (4375, null, '660-265-4414 ext. 1406', 'High School Assistant Principal'),
    (4487, null, '660-265-4414 ext. 1402', 'Assistant Principal')
  ) v(id, email, phone, job_name)
  left join public.staff s on s.staff_id = v.id
  where s.staff_id is null or s.archived or s.manual_fields <> '{}' or s.pending_scraped <> '{}'
     or s.email is distinct from v.email or s.phone is distinct from v.phone
     or s.job_name is distinct from v.job_name;
  if bad > 0 or (select count(*) from backup.duplicate_merge_20261001) <> 12 then
    raise exception '% of the 12 records are not as listed; nothing was merged.', bad;
  end if;
end $check$;

-- 1. Conflicts: the new value waits in pending_scraped and that field is locked. Done
--    with sign-in claims set for this transaction, so the db/006/012 trigger takes the
--    app path: it keeps manual_fields as sent and locks nothing else.
select set_config('request.jwt.claims', '{"role":"maintainer","email":"oodedai@siue.edu"}', true);
update public.staff s
   set manual_fields = array_append(s.manual_fields, c.col),
       pending_scraped = s.pending_scraped || jsonb_build_object(c.col, jsonb_build_object(
         'value', c.value, 'seen_at', now(), 'from', 'duplicate #' || c.from_id || ', merged 2026-10-01'))
  from (values
    (455,  'phone',    '708-741-5652',                    4394),
    (862,  'job_name', 'High School Principal',           4405),
    (1233, 'job_name', 'Jr. High/ High School Principal', 4413),
    (4375, 'phone',    '660-265-4414 ext. 1402',          4487)
  ) c(id, col, value, from_id)
 where s.staff_id = c.id;

-- 2. Blanks filled and the duplicates archived, without claims: the trigger takes the
--    scraper path, which writes unlocked columns and never adds a lock.
select set_config('request.jwt.claims', '', true);
update public.staff set email = 'lmay@olchs.org' where staff_id = 455 and email is null;
update public.staff set phone = '309-793-5924' where staff_id = 1730 and phone is null;
update public.staff set phone = '815-836-2724' where staff_id = 1919 and phone is null;

update public.staff s
   set archived = true,
       archived_by = 'oodedai@siue.edu',
       notes = s.notes || E'\n' || 'Archived 2026-10-01: merged into #' || m.into_id || ' ' || m.into_name
               || ' (duplicate added by the old scraper''s run of 2026-10-01 03:13 UTC). ' || m.what
  from (values
    (4394, 455,  'Dr. Lauren May',       'Email filled in; phone 708-741-5652 waiting for review.'),
    (4445, 1730, 'Timothy Wernentin',    'Phone filled in.'),
    (4446, 1919, 'Johnny Billingsley',   'Phone filled in.'),
    (4405, 862,  'Dr. Erik Borne',       'Title "High School Principal" waiting for review.'),
    (4413, 1233, 'Mrs. Tabatha Cohorst', 'Title "Jr. High/ High School Principal" waiting for review.'),
    (4487, 4375, 'Ched Hurley',          'Phone ext. 1402 waiting for review.')
  ) m(dup_id, into_id, into_name, what)
 where s.staff_id = m.dup_id;

commit;

-- Review: 4 locked fields with a waiting value, 3 blanks filled, 6 archived, nothing else
-- locked.
--   select staff_id, manual_fields, pending_scraped, email, phone, archived from public.staff
--   where staff_id in (455, 4394, 1730, 4445, 1919, 4446, 862, 4405, 1233, 4413, 4375, 4487)
--   order by staff_id;
