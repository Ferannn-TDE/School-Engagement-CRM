-- 027 — "Last updated" that means a real change, and who/when for Verify and Unverify
--
-- DRAFT, NOT APPLIED. Run the BEFORE APPLYING checks, apply in the SQL Editor, then run
-- TEST 1–3 and paste the outputs into "Checked before applying" at the bottom.
--
-- Why: the app will show "Last updated <date>" on schools and contacts and flag records
-- not updated in over 12 months (replacing "Not verified in 6+ months"). Today
-- updated_at can't say that:
--   * the scraper writes updated_at = the run time on every school and staff row it
--     touches, changed or not (checked 2026-11-12: updated_at equals last_scraped_at on
--     every scraped row in a 1,000-row sample of each table);
--   * the app's own edits never set it.
-- And Verified is moving to a plain on/off switch with an Unverify button, which needs
-- a who/when stamp; today only last_verified_at exists, set from the browser's clock.
--
-- What it adds, on public.schools and public.staff:
--   * updated_by   text — who made the last content change (signed-in email, or
--                  'database' for the owner connection: scraper, SQL Editor).
--   * verified_by  text — who last turned Verified on or off.
--   * stamp_record_changes (before update), on both tables:
--       - updated_at / updated_by change only when the row's content changes. What
--         isn't content (ignored): updated_at, updated_by, created_at, the scraper's
--         bookkeeping (last_scraped_at, source_status, source_checked_at, missed_runs,
--         missing_since, scraper_score, scraper_score_at, is_scraped, data_source,
--         pending_scraped), the edit locks (manual_fields), archiving (archived,
--         archived_at, archived_by) and verification (is_verified, last_verified_at,
--         verified_by). Anything else changing (name, phone, email, title, address,
--         notes, is_active, links, priority tier, ...) is an update. A value the
--         request sends for updated_at / updated_by is ignored.
--       - Turning Verified on or off stamps last_verified_at = now() and verified_by.
--         Otherwise both keep their old values, whatever the request sends: the
--         scraper's write of last_verified_at = NULL on unverified rows no longer
--         wipes them. (So last_verified_at now means "when Verified was last switched",
--         either way.) null and false count as the same.
--   * Runs after protect_manual_edits (006/012; triggers fire in name order), so a
--     scraper write that the edit lock reverts doesn't count as an update.
--
-- Existing rows: nothing is changed or backfilled. updated_at keeps its current value
-- (for scraped rows, the last run they were seen in: 2026-11-01 for most), updated_by
-- and verified_by start null. From now on, a scraper run that changes nothing leaves
-- updated_at alone. No data is deleted.
--
-- Not affected: inserts (the scraper still sets created_at / updated_at on new rows),
-- RLS and policies (003, 010, 023, 025), grants (021), the edit locks (006/012), the
-- archive stamps (009). The scraper needs no change.
--
-- BEFORE APPLYING (read-only):
--   -- 1. The new columns don't exist yet. Expect no rows.
--   select table_name, column_name from information_schema.columns
--   where table_schema = 'public' and table_name in ('schools', 'staff')
--     and column_name in ('updated_by', 'verified_by');
--   -- 2. Triggers on the two tables. Expect protect_manual_edits, stamp_archive and the
--   --    bulk-delete guard, and nothing called stamp_record_changes.
--   select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where c.relname in ('schools', 'staff') and c.relnamespace = 'public'::regnamespace
--     and not t.tgisinternal order by 1, 2;
--   -- 2b. Every BEFORE UPDATE row trigger on the two tables, in firing order (same
--   --     event and timing fire in name order). stamp_record_changes will sort after
--   --     protect_manual_edits and stamp_archive; confirm nothing listed would sort
--   --     after "stamp_record_changes" and change content (it would run after the stamp).
--   select c.relname, t.tgname, t.tgfoid::regproc as function,
--          t.tgname > 'stamp_record_changes' as would_run_after_stamp
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where c.relname in ('schools', 'staff') and c.relnamespace = 'public'::regnamespace
--     and not t.tgisinternal
--     and t.tgtype & 2 = 2      -- BEFORE
--     and t.tgtype & 16 = 16    -- UPDATE
--     and t.tgtype & 1 = 1      -- FOR EACH ROW
--   order by 1, 2;
--   -- 3. Counts, to compare after applying (nothing should change).
--   select (select count(*) from public.schools) as schools,
--          (select count(*) from public.schools where is_verified) as verified_schools,
--          (select count(*) from public.staff) as staff,
--          (select count(*) from public.staff where is_verified) as verified_staff;
--   -- 4. Every column of both tables, to compare with the not_content list. Expect 38
--   --    for schools and 24 for staff (checked from the app on 2026-11-12).
--   select table_name, ordinal_position, column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name in ('schools', 'staff')
--   order by table_name, ordinal_position;
--
-- Reversible: see REVERSE at the bottom (it keeps the columns and what's in them).

begin;

alter table public.schools
  add column if not exists updated_by text,
  add column if not exists verified_by text;
alter table public.staff
  add column if not exists updated_by text,
  add column if not exists verified_by text;

create or replace function public.stamp_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  who text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'database'
  );
  not_content text[] := array[
    'updated_at', 'updated_by', 'created_at',
    'last_scraped_at', 'source_status', 'source_checked_at', 'missed_runs', 'missing_since',
    'scraper_score', 'scraper_score_at', 'is_scraped', 'data_source', 'pending_scraped',
    'manual_fields',
    'archived', 'archived_at', 'archived_by',
    'is_verified', 'last_verified_at', 'verified_by'
  ];
begin
  -- Verified switch: stamped only when it actually flips.
  if coalesce(new.is_verified, false) is distinct from coalesce(old.is_verified, false) then
    new.last_verified_at := now();
    new.verified_by := who;
  else
    new.last_verified_at := old.last_verified_at;
    new.verified_by := old.verified_by;
  end if;

  -- Content: stamped only when something other than bookkeeping changed.
  if (to_jsonb(new) - not_content) is distinct from (to_jsonb(old) - not_content) then
    new.updated_at := now();
    new.updated_by := who;
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$fn$;

drop trigger if exists stamp_record_changes on public.schools;
create trigger stamp_record_changes before update on public.schools
  for each row execute function public.stamp_record_changes();

drop trigger if exists stamp_record_changes on public.staff;
create trigger stamp_record_changes before update on public.staff
  for each row execute function public.stamp_record_changes();

revoke all on function public.stamp_record_changes() from public, anon;

commit;


-- ============================================================================
-- VERIFICATION (read-only, except TEST 3, which undoes its own changes)
-- ============================================================================

-- TEST 1 — the columns. Expect 4 rows: updated_by and verified_by, text, on both tables.
-- select table_name, column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name in ('schools', 'staff')
--   and column_name in ('updated_by', 'verified_by') order by 1, 2;

-- TEST 2 — nothing existing changed. Expect the same four numbers as BEFORE APPLYING
-- check 3, and 0 rows stamped.
-- select (select count(*) from public.schools) as schools,
--        (select count(*) from public.schools where is_verified) as verified_schools,
--        (select count(*) from public.staff) as staff,
--        (select count(*) from public.staff where is_verified) as verified_staff,
--        (select count(*) from public.schools where updated_by is not null or verified_by is not null)
--      + (select count(*) from public.staff where updated_by is not null or verified_by is not null) as stamped;

-- TEST 3 — the rules, written for the SQL Editor. Select everything from "do $test027$"
-- to the end of the final select and run it. It adds a made-up editor role row (not a
-- real person), changes one school and one staff row, and undoes every change: the work
-- happens inside an inner block that always ends by raising an exception, and only the
-- report survives, in a setting. Expect every line to start with PASS.
/*
do $test027$
declare
  report text := '';
  e uuid := '00000000-0000-4000-8000-0000000027e1';
  k text;
  k2 text;
  k3 text;
  sid integer;
  sid2 integer;
  r record;
  before_at timestamptz;
  orig_at timestamptz;
  orig3_at timestamptz;
  claims text;
begin
  begin
    insert into public.user_roles (user_id, email, role) values (e, 'test027-editor@siue.edu', 'editor');
    -- Separate rows, so no check can pass because an earlier one already stamped the
    -- row (now() is the same for the whole transaction).
    select facility_key into k from public.schools where not archived order by facility_key limit 1;
    select facility_key into k2 from public.schools where not archived order by facility_key offset 1 limit 1;
    select facility_key into k3 from public.schools where not archived order by facility_key offset 2 limit 1;
    select staff_id into sid from public.staff where not archived order by staff_id limit 1;
    select staff_id into sid2 from public.staff where not archived and is_active is not false order by staff_id offset 1 limit 1;
    -- Start unverified (a switch, not an update), and note updated_at.
    update public.schools set is_verified = false where facility_key = k;
    select updated_at into before_at from public.schools where facility_key = k;

    -- 1. A scraper-style run that changes nothing but bookkeeping keeps updated_at.
    update public.schools
       set last_scraped_at = now(), updated_at = now(), missed_runs = 0, data_source = data_source
     where facility_key = k;
    select updated_at, updated_by into r from public.schools where facility_key = k;
    report := report || case when r.updated_at = before_at and r.updated_by is null
      then 'PASS 1 a run that changes nothing keeps updated_at'
      else 'FAIL 1 updated_at moved to ' || coalesce(r.updated_at::text, 'null') end || E'\n';

    -- 2. The owner changing content (notes) stamps 'database'.
    update public.schools set notes = coalesce(notes, '') || ' TEST 027' where facility_key = k;
    select updated_at, updated_by into r from public.schools where facility_key = k;
    report := report || case when r.updated_at > before_at and r.updated_by = 'database'
      then 'PASS 2 a content change by the owner stamps updated_at, by database'
      else 'FAIL 2 after owner edit: ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 3. The edit lock (006/012), on its own untouched school (k2): a scraper write to a
    --    locked field is reverted, and doesn't count as an update. Locking a field is
    --    bookkeeping, so it doesn't count either.
    --    Only the app can lock a field (an owner write resets manual_fields), so the lock
    --    is set as the made-up editor, then the write comes from the owner, like the scraper.
    select updated_at into orig_at from public.schools where facility_key = k2;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                                               'email', 'test027-editor@siue.edu')::text, true);
    update public.schools set manual_fields = array_append(coalesce(manual_fields, '{}'), 'phone')
     where facility_key = k2;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.schools set phone = 'TEST 027 scraper' where facility_key = k2;
    select phone, updated_at, updated_by into r from public.schools where facility_key = k2;
    report := report || case when r.phone is distinct from 'TEST 027 scraper'
        and r.updated_at is not distinct from orig_at and r.updated_by is null
      then 'PASS 3 locking a field, and a reverted scraper write to it, are not updates'
      else 'FAIL 3 phone ' || coalesce(r.phone, 'null') || ', updated_at ' || coalesce(r.updated_at::text, 'null')
        || ', updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 4. The scraper writing last_verified_at = NULL on an unverified row keeps the stamp.
    update public.schools set is_verified = true where facility_key = k;   -- owner: stamps database
    update public.schools set is_verified = false where facility_key = k;
    select last_verified_at into before_at from public.schools where facility_key = k;
    update public.schools set last_verified_at = null, verified_by = null where facility_key = k;
    select last_verified_at, verified_by into r from public.schools where facility_key = k;
    report := report || case when r.last_verified_at = before_at and r.verified_by = 'database'
      then 'PASS 4 writing last_verified_at without switching Verified changes nothing'
      else 'FAIL 4 last_verified_at ' || coalesce(r.last_verified_at::text, 'null') end || E'\n';

    -- For tests 6 and 7: k3 starts unverified, and its original updated_at is noted.
    update public.schools set is_verified = false where facility_key = k3;
    select updated_at into orig3_at from public.schools where facility_key = k3;

    set local role authenticated;
    claims := json_build_object('sub', e, 'role', 'authenticated', 'aal', 'aal2',
                                'email', 'test027-editor@siue.edu')::text;
    perform set_config('request.jwt.claims', claims, true);

    -- 5. An editor's content edit stamps their email; a sent updated_at is ignored.
    update public.schools set notes = coalesce(notes, '') || ' edited', updated_at = '1999-01-01', updated_by = 'someone-else'
     where facility_key = k;
    select updated_at, updated_by into r from public.schools where facility_key = k;
    report := report || case when r.updated_at > now() - interval '1 minute' and r.updated_by = 'test027-editor@siue.edu'
      then 'PASS 5 an editor''s edit stamps their email and ignores sent values'
      else 'FAIL 5 updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 6. Verify, as the editor, on another untouched school (k3): stamps
    --    last_verified_at and verified_by; updated_at keeps the row's original value and
    --    updated_by stays null. (k3 was set unverified as the owner, before the editor
    --    signed in, below; that switch doesn't touch updated_*.)
    update public.schools set is_verified = true, last_verified_at = '1999-01-01' where facility_key = k3;
    select is_verified, last_verified_at, verified_by, updated_at, updated_by into r from public.schools where facility_key = k3;
    report := report || case when r.is_verified and r.last_verified_at = now()
        and r.verified_by = 'test027-editor@siue.edu'
        and r.updated_at is not distinct from orig3_at and r.updated_by is null
      then 'PASS 6 Verify stamps who and when, and is not an update'
      else 'FAIL 6 verified_by ' || coalesce(r.verified_by, 'null') || ', updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 7. Unverify, as the editor, on k3: the same stamp, and still not an update.
    update public.schools set is_verified = false where facility_key = k3;
    select is_verified, verified_by, updated_at, updated_by into r from public.schools where facility_key = k3;
    report := report || case when not r.is_verified and r.verified_by = 'test027-editor@siue.edu'
        and r.updated_at is not distinct from orig3_at and r.updated_by is null
      then 'PASS 7 Unverify stamps who and when, and is not an update'
      else 'FAIL 7 after unverify: ' || coalesce(r.verified_by, 'null') || ', updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 8. Staff: a content edit (job title) stamps; deactivating counts as an update too.
    update public.staff set job_name = coalesce(job_name, '') || ' TEST 027' where staff_id = sid;
    select updated_by, updated_at into r from public.staff where staff_id = sid;
    report := report || case when r.updated_by = 'test027-editor@siue.edu' and r.updated_at > now() - interval '1 minute'
      then 'PASS 8 a staff edit stamps who and when'
      else 'FAIL 8 staff updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    -- 8b. Deactivating another, untouched staff row (sid2) is an update too.
    update public.staff set is_active = false where staff_id = sid2;
    select is_active, updated_by, updated_at into r from public.staff where staff_id = sid2;
    report := report || case when r.is_active is false and r.updated_by = 'test027-editor@siue.edu' and r.updated_at = now()
      then 'PASS 8b deactivating a contact stamps who and when'
      else 'FAIL 8b after deactivate: updated_by ' || coalesce(r.updated_by, 'null') end || E'\n';

    raise exception 'test027: undo everything';
  exception when others then
    if sqlerrm <> 'test027: undo everything' then
      report := report || 'FAIL stopped early: ' || sqlerrm || E'\n';
    end if;
  end;
  perform set_config('test027.report', report, false);
end
$test027$;

select line as result
from regexp_split_to_table(rtrim(current_setting('test027.report'), E'\n'), E'\n') with ordinality as t(line, n)
union all
select case when (select count(*) from public.user_roles where email like 'test027-%') = 0
             and (select count(*) from public.schools where notes like '%TEST 027%' or phone = 'TEST 027 scraper') = 0
             and (select count(*) from public.staff where job_name like '%TEST 027%') = 0
            then 'PASS 9 rolled back: no test changes left'
            else 'FAIL 9 test changes were left behind' end;
*/


-- ============================================================================
-- REVERSE (stops the stamping; keeps the columns and what's in them)
-- ============================================================================
/*
begin;
drop trigger if exists stamp_record_changes on public.schools;
drop trigger if exists stamp_record_changes on public.staff;
drop function if exists public.stamp_record_changes();
commit;
*/


-- ============================================================================
-- Checked before applying (paste the BEFORE APPLYING and TEST outputs here)
-- ============================================================================
--   Applied 2026-11-12 in the SQL Editor. Results as reported:
--   * BEFORE APPLYING 1: no rows.
--   * Check 2: guard_bulk_delete, protect_manual_edits and stamp_archive on both tables.
--   * Check 2b: protect_manual_edits and stamp_archive on both tables; every
--     would_run_after_stamp = false.
--   * Check 3: schools 1,795 (verified 2); staff 4,633 (verified 2).
--   * Check 4: 38 columns on schools, 24 on staff.
--   * Migration: success.
--   * TEST 1: 4 columns.
--   * TEST 2: the same counts as check 3; stamped 0.
--   * TEST 3: PASS 1–8, 8b and 9.
--   Before applying, TEST 3 was also run on a throwaway Postgres with both tables'
--   columns and the 006/012 edit lock: all PASS, and with a trigger that stamps every
--   update, tests 1, 2, 3, 6 and 7 fail, as they should.
