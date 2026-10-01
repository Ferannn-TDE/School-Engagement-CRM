# Database notes for maintainers

The live database is Supabase (PostgreSQL). Every change to it is a numbered file in
this folder, applied in order through the Supabase SQL Editor and committed only after
it has been applied and checked. Nothing is changed by hand in the dashboard: that is
how 001 and 002 went missing once (found and re-applied on 2026-09-26/28).

| File | What it does |
|---|---|
| `001_restrict_reference_table_deletes.sql` | Signed-in users cannot delete from `district`, `county`, `state`. |
| `002_guard_bulk_deletes.sql` | A single delete of more than 100 rows from the app is refused. |
| `003_require_mfa_aal2.sql` | The six data tables require a completed two-factor sign-in (aal2). Records rules first added in the dashboard. |
| `004_restrict_signup_to_siue.sql` | Only `@siue.edu` addresses can create an account (auth hook, enabled in Authentication → Hooks). |
| `005_county_views_by_state.sql` | County views group by county **and** state (40 names exist in both IL and MO). |
| `006_protect_manual_edits.sql` | A client's edit is never overwritten by the scraper (below). |
| `007_event_category_testing_dates.sql` | `events.category`; the 15 existing SAT/ACT/PSAT events are marked `school_testing_date` (busy dates, not outreach). Same rules as the scraper's testing-dates list, which also covers AP exams. |
| `008_county_views_skip_testing_dates.sql` | The county views ignore testing dates, so they don't count as events or make a school "engaged". |
| `009_archive_instead_of_delete.sql` | `archived`, `archived_at`, `archived_by` on schools, staff, contacts, events, programs and activities; `archive_school` / `restore_school` and `archive_contact` / `restore_contact`; the county views skip archived rows. The app never deletes; Settings → Archived restores. |
| `010_deny_deletes_from_signed_in_users.sql` | Signed-in users cannot delete from any table (001 covered the three reference tables; this covers the six data tables). The owner (scraper, SQL Editor) is unaffected. |
| `011_freshness_tracking.sql` | Freshness columns: `last_scraped_at`, `source_status` (working / broken / not_found), `source_checked_at`, `missed_runs` and `missing_since` on schools (staff: `last_scraped_at`, `missed_runs`, `missing_since`). `missing_since` can only be set once `missed_runs` reaches 3. The scraper fills them (not yet); the app shows plain-language labels. |
| `012_resolve_locked_fields.sql` | Revises the 006 trigger function so the client can answer "The website now says X — keep yours or use this?": accepting the website's value unlocks the field; "keep yours" is remembered until the website shows a different value. |
| `013_link_overrides.sql` | `website_override` and `staff_page_override` on schools: the client's own links, stored apart from the scraped `website` and never written by the scraper. Only http(s) links are accepted. The school page shows which link is in use. |
| `014_staff_scraper_score.sql` | `scraper_score` and `scraper_score_at` on staff, so the scraper's confidence score stops going into `notes`. The scores already in notes stay there; copying them over is a separate, approved step. |
| `015_restore_scraper_run_2026-09-30.sql` | Applied 2026-10-01: undid what the old scraper (from main) overwrote in its runs of 2026-09-30 19:48 UTC and 2026-10-01 03:13 UTC: 117 staff values and 22 event locations back to the 2026-09-29 snapshot. The values it replaced are in `backup.scraper_runs_20260930_20261001`. New rows were kept. |
| `018_copy_scores_from_notes.sql` | Applied 2026-10-01: copied each staff score from `notes` into `scraper_score` (4,352). `notes` unchanged. |
| `016_reset_bulk_verified_flag.sql` | Applied 2026-10-01 with the scraper-fixes merge: cleared `is_verified` / `last_verified_at` on the 1,683 schools bulk-flagged on 2026-09-02 (saved in `backup.bulk_verified_20260902`). |
| `017_school_calendar_times_to_central.sql` | Applied 2026-10-01 with the scraper-fixes merge: the 121 school-calendar event times stored in UTC are now Central (old values in `backup.school_calendar_times_utc`). The app no longer converts them or locks their time. |

## Archive, never delete (009)

The app has no delete. Archiving sets `archived = true`; the row stays and is left out
of every list, count and county view. `archived_at` and `archived_by` (the signed-in
user's email, or `database` without sign-in claims) are stamped by a trigger and
cleared on restore.

- A school is archived with its staff and their school links in one call
  (`archive_school`), all with the same `archived_at`. `restore_school` brings back
  exactly the rows with that timestamp, so a contact archived separately earlier stays
  archived. `archive_contact` / `restore_contact` do the same for a person and their
  links.
- Moving a contact to another school archives the old link and adds (or reactivates)
  the new one, so the history of which schools they were at is kept.
- To find archived rows by hand: `select * from schools where archived;` (same for the
  other five tables). To restore by hand, use the app, or
  `select restore_school('<facility_key>');` with claims set as in the unlock command
  below.
- Deletes are refused at the database (010): a delete sent with a signed-in user's
  token removes 0 rows on every table, silently (no error). Only the owner connection
  (the scraper, the SQL Editor) can delete, and nothing in this project should.
- **`npm run verify:no-deletes`** fails if any code under `src/` calls a delete on the
  database (`.delete()` or `.delete({ ... })`), and says to archive instead. Run it with
  `verify:import` before merging; it is listed for CI under Epic 4 on the plan page.
- The app hides every contact whose school is archived, including staff the scraper
  adds to that school later (they aren't archived themselves). They come back when the
  school is restored.
- Imports never touch an archived record silently: the preview lists rows that match
  one, and the person restores the record or skips those rows (the default).
- The scraper doesn't know about archiving yet: it still updates archived rows (they
  stay archived, and hidden) and can add staff to an archived school (hidden, as
  above). Making it skip archived schools is on seandsw's list.

## How the app and the scraper are told apart

Requests from the app carry sign-in claims (`request.jwt.claims`). The scraper connects
straight to the database with `DATABASE_URL` and carries none. 002 and 006 both use this
difference.

**Anything else without claims is treated like the scraper.** That includes queries you
type into the Supabase SQL Editor.

## Edit locks (006)

`schools` and `staff` each have two extra columns:

- `manual_fields`: the columns a person has changed on that row, e.g. `{phone,city}`.
- `pending_scraped`: what the scraper tried to write over a locked column, and when,
  e.g. `{"phone": {"value": "618-555-0199", "seen_at": "2026-09-29T04:09:53Z"}}`.

What happens on every update:

- **From the app:** each protected column the update changes is added to
  `manual_fields`. Setting a value back to what it was is still a change, so the column
  stays locked.
- **From the scraper (or anything without claims):** every column in `manual_fields`
  keeps the client's value. The update still succeeds; the scraper's value for that
  column is saved in `pending_scraped` instead. Columns that are not locked update as
  usual.

Protected columns:

- `schools`: name, phone, address, type_of_school, admin, city, zipcode, grades_served,
  website, county_name, is_active, notes, enrollment, grade_range, priority_tier,
  state_code
- `staff`: name, phone, email, job_name, school_worked_at, is_active, notes

### Things to know

- **Unlocking, for the client: in the app.** Where a field is locked and
  `pending_scraped` holds a newer value from the scraper, the app asks: "The website
  now says X — keep yours or use this?" (school page, "Updates from the website").
  *Use this* applies the scraper's value and removes the lock; *keep yours* keeps the
  value and the lock and marks the entry `dismissed` (with `dismissed_at` and
  `dismissed_by`), so it isn't asked again unless the website shows a different value.
  This is the client's way to unlock after handoff (012).
- How 012 tells them apart: an app update that sets a column to exactly the value in
  `pending_scraped` **and** removes that entry in the same update is accepting it, so
  the column is unlocked. Any other app edit locks the column, as in 006.
- **SQL Editor edits cannot change a locked column.** They are treated like the
  scraper, so the change is kept aside in `pending_scraped` and the old value stays.
  **Maintainer fallback:** to change a locked column, use the app, or first remove
  the column from `manual_fields`. **The unlock itself must carry claims:** without them the trigger
  puts `manual_fields` back as it was, so a plain `update ... set manual_fields = ...`
  silently does nothing. In the SQL Editor, set claims for that one transaction:

  ```sql
  begin;
  select set_config('request.jwt.claims', '{"role":"maintainer"}', true);
  update schools set manual_fields = array_remove(manual_fields, 'phone')
  where facility_key = '...';
  commit;
  ```

  The `true` limits the setting to this transaction. Only `manual_fields` changes, so
  nothing new is locked. (Checked against the 006 trigger on 2026-09-29: the plain
  update left the lock in place; this one removed it.)
- **Imports run through the app**, so the columns an import fills in are locked too.
- **Bookkeeping columns are not protected:** `updated_at`, `is_verified`,
  `last_verified_at`, `data_source` and so on.
- **The scraper still matches people by job title when they have no email or phone**
  (until the scraper-fixes branch is merged). If a client corrects such a title, the
  next scraper run can insert a duplicate. Don't run the scraper until that fix is in.

### Undo

Drop the two triggers and the function (`protect_manual_edits`). The two columns can
stay, since they hold history, or be dropped after their contents are exported.
