-- 016 — Undo the bulk "verified" flag of 2026-09-02 (Phase 5 step 3)
-- APPLY RIGHT AFTER scraper-fixes is merged, in the same release as 88317c0.
--
-- Why: 1,683 of the schools were marked verified in one load on 2 Sep 2026, all with
-- last_verified_at = 2026-09-02 22:21:01+00. Nobody checked them. "Verified" is meant
-- to say "a person confirmed this on a date". The old scraper also skipped every
-- verified school, so none of them has been refreshed since.
--
-- 88317c0 (scraper-fixes) stops the scraper skipping verified rows; the db/006 edit
-- locks protect what a person changed instead. Merged without this reset, nothing
-- breaks, but the 1,683 schools would keep a "Verified" badge nobody earned.
-- Applied without 88317c0, the old scraper would start rewriting those schools
-- (it only skips verified ones), so the two go out together.
--
-- What changes: is_verified = false and last_verified_at = NULL, only for schools
-- that still carry the exact bulk timestamp. A school a person has verified since
-- has a different timestamp and is left alone. Staff: none is verified (2026-09-30).
-- The values are saved first in backup.bulk_verified_20260902.
--
-- is_verified and last_verified_at aren't covered by the db/006 locks, so no field
-- gets locked. The app then shows these schools as "Unverified".
--
-- UNDO: update public.schools s set is_verified = b.is_verified,
--         last_verified_at = b.last_verified_at
--       from backup.bulk_verified_20260902 b where b.facility_key = s.facility_key;

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.bulk_verified_20260902 as
select facility_key, is_verified, last_verified_at, now() as saved_at
  from public.schools
 where is_verified and last_verified_at = '2026-09-02 22:21:01+00';
alter table backup.bulk_verified_20260902 add primary key (facility_key);
alter table backup.bulk_verified_20260902 enable row level security;
revoke all on backup.bulk_verified_20260902 from public, anon, authenticated;

update public.schools s
   set is_verified = false, last_verified_at = null
  from backup.bulk_verified_20260902 b
 where b.facility_key = s.facility_key;

do $check$
declare saved int; left_verified int;
begin
  select count(*) into saved from backup.bulk_verified_20260902;
  select count(*) into left_verified from public.schools
   where is_verified and last_verified_at = '2026-09-02 22:21:01+00';
  if left_verified <> 0 then
    raise exception '% bulk-verified school(s) were not reset; nothing was changed.', left_verified;
  end if;
  raise notice 'Reset % bulk-verified schools (expected 1,683 on 2026-09-30).', saved;
end $check$;

commit;
