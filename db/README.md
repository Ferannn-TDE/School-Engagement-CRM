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
  now says X — keep yours or use this?" *Use this* applies the scraper's value and
  removes the lock; *keep yours* dismisses it (the lock stays). This is the client's
  way to unlock after handoff. (Planned: Phase 5, right after the freshness step.
  Until it ships, use the maintainer fallback below.)
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
