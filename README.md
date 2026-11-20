# SIUE Engineering Outreach CRM

A web app for the **SIUE School of Engineering** K–12 outreach team. It keeps track of
the high schools in Illinois and Missouri, the people who work there, the college fairs
and school events SIUE takes part in, and every visit, call, email or event a school has
had with SIUE. Reports show which schools and counties are being reached and which are
not.

**Who uses it:** the outreach staff in the School of Engineering (they log activities,
import attendance lists, keep contacts up to date and read the reports), and the
student developers and maintainers who look after the code, the database and the
monthly scraper.

- Live site: built by Vercel from `main`.
- Database and sign-in: Supabase (PostgreSQL).
- Database change log, open items and proposals: [`db/README.md`](db/README.md).

---

## Stack

| Part | What we use |
|---|---|
| App | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4 |
| Routing, state | React Router v7; React Context with `useReducer` (`src/context/AppContext.tsx`) |
| Tables, charts, forms | TanStack Table v8, Recharts v3, React Hook Form with Zod v4 |
| Spreadsheets | SheetJS (`xlsx`) and PapaParse for imports and exports |
| Backend | Supabase: PostgreSQL with row-level security, Auth (password plus authenticator app) |
| Hosting | Vercel (`vercel.json` sends every path to `index.html`) |
| Scraper | Python 3.11 in `Scraper/`, run monthly by GitHub Actions |

## Folder layout

```
src/
  pages/        one file per screen (Dashboard, Schools, Contacts, Events, Import,
                Reports, Priorities, Counties, Generate Lists, Settings, Team, Archived …)
  components/   screen parts, grouped by area (schools, contacts, events, imports,
                reports, layout, common …)
  services/     every Supabase read and write; database column names are turned into
                app field names here and nowhere else
  context/      signed-in user, role, and the loaded data (AppContext)
  utils/        rules shared by screens and tests: reports, priorities, form rules,
                import matching, plain-English save errors
  hooks/, constants/, types/
db/             numbered SQL migrations (001–031), db/README.md, db/checks/
scripts/        the verify scripts and their fixtures
Scraper/        the Python scraper and its tests
.github/workflows/
  ci.yml                App CI: lint, typecheck, build and every verify script
  monthly-scraper.yml   the monthly scraper run
  scraper-tests.yml     the scraper's unit tests
```

## Run it locally

You need Node 24 (CI uses 24) and npm.

```bash
npm install
npm run dev        # http://localhost:5173, or the next free port if it's taken
```

Create a `.env` file in the project root with these two variables. Ask a current
maintainer for the values, or copy them from Supabase → Project Settings → API. Never
commit `.env`.

| Variable | What it is |
|---|---|
| `VITE_SUPABASE_URL` | The Supabase project address |
| `VITE_SUPABASE_ANON_KEY` | The Supabase public (anon) key. It ships to every browser; it is safe only because every table has row-level security |

Local development uses the **live** database. Anything you save locally is saved for
real, so use a name like `TEST - delete me` for trial records and archive them after.

Other commands:

```bash
npm run build      # typecheck and production build into dist/
npm run preview    # serve the built dist/ locally
npm run lint       # ESLint
```

## Deploys

- **Live site:** Vercel builds and deploys `main` on every merge.
- **Previews:** Vercel builds a preview for every pull request (and every pushed
  branch) and posts its link on the PR.
- **Branch protection:** `main` takes changes only through a pull request with **App
  CI** passing. Open a branch, open a PR into `main`, wait for App CI and the Vercel
  preview, check the preview, then merge.
- The build needs no secrets: the two `VITE_` variables are set in the Vercel project
  settings.

## Roles and sign-in

| Role | Can do |
|---|---|
| **viewer** | Read everything. Cannot change anything. |
| **editor** | Read and change data: schools, contacts, events, activities, imports. |
| **admin** | Everything an editor can, plus Settings → Team (change roles) and every problem report. |

- **New sign-ups start as viewers.** An admin raises them in Settings → Team. Every role
  change is logged there.
- **Editors and admins need an authenticator app** (two-factor sign-in). The first time
  they sign in they are asked to set one up (`/mfa/enroll`), and after that they enter
  its code each time (`/mfa/verify`). Viewers sign in with a password only.
- The database enforces roles, not just the screens: a viewer's save is refused by
  row-level security, and the app explains why.
- Handing over admin to a new maintainer, step by step: `db/README.md` → "Roles".

## How the data is protected

- **Archive instead of delete.** Nothing in the app deletes. Archiving hides a record
  from every list, count and report and keeps it in the database; Settings → Archived
  brings it back. Signed-in users have no delete permission at all, and
  `npm run verify:no-deletes` fails CI if code tries one.
- **Row-level security** on every table: signed-in users only, editors and admins for
  changes, and the authenticator step for editors and admins.
- **Bulk-delete guard.** A single delete of more than 100 rows is refused at the
  database (002), as a second layer.
- **Edit locks on scraped fields.** When a person edits a school or contact field the
  scraper also fills (phone, address, title …), that field is locked: the scraper never
  overwrites it. If the website later shows a different value, the school page asks
  "keep yours or use this?" (006, 012).
- **Who and when stamps.** Records show who last changed them and when, who verified
  them, who logged each activity, who imported each batch, and who archived what
  (009, 026, 027).
- Visitors' names from attendance lists are student data: editors and admins only, never
  in lists, exports or Reports (`npm run verify:no-names`). How to remove one:
  `db/README.md` → "Removing a visitor's name".

## Applying a database migration

Every database change is a numbered file in `db/` (`001_…sql` to `031_…sql`; the next
is **032**). Nothing is changed by hand in the Supabase dashboard. Changes are
expand/contract: stop using a column in one release, drop it in a later migration.

1. Write the migration as the next number. Each file has a **BEFORE APPLYING** section
   (read-only checks), the migration itself, **TEST** blocks, and a **REVERSE** section.
2. Open Supabase → SQL Editor. Run each BEFORE APPLYING query **one at a time** and
   check the result matches what the file expects. Stop if it doesn't.
3. Run the migration.
4. Run each TEST block one at a time and check every result.
5. Record the results in the file (the date, and what each check returned), and add or
   update its row in the table in `db/README.md` with its status. Commit both through a
   pull request.

Queries in the SQL Editor run as the database owner, which row-level security and the
edit locks treat like the scraper. `db/README.md` → "Edit locks" explains how to change
a locked field from there.

## The monthly scraper

The scraper keeps the school and staff lists current. Each run:

- downloads the official school directories (Illinois State Board of Education,
  Missouri DESE) and adds or updates schools;
- reads school websites for staff and school-calendar events, and the IACAC college
  fair list;
- snapshots the tables into the database's `backup` schema first, and saves a list of
  every value it changed as a downloadable file on the run;
- never overwrites a field a person has edited (the edit locks above).

It runs on the 1st of each month at 2:00 AM Central (`.github/workflows/monthly-scraper.yml`)
and can be started by hand from GitHub → Actions → Monthly School Scraper. The code is
in `Scraper/`, its tests in `Scraper/tests/` (run by the Scraper Tests workflow). It
connects straight to Postgres with the `DATABASE_URL` repository secret, not through the
app. **Sean owns the scraper**: ask him before changing it or the `50-states` branch.

Scraper environment variable names (values live in GitHub secrets or your shell, never
in the repo): `DATABASE_URL`, and for the IACAC events `IACAC_EVENTS_API_URL`,
`IACAC_KNACK_APP_ID`, `IACAC_KNACK_SCENE`, `IACAC_KNACK_VIEW`.

## Verify scripts and CI

App CI (`.github/workflows/ci.yml`) runs on every pull request into `main` and every
push to `main`: install, lint, typecheck, build, then the verify scripts below. None of
them needs a database or any secret.

| Command | What it checks |
|---|---|
| `npm run verify:import` | Reading uploaded spreadsheets: sheet and column detection, empty and wrong files |
| `npm run verify:activity-import` | Matching an attendance list's school names to schools, against a made-up fixture |
| `npm run verify:reports` | Every Reports figure against values worked out by hand |
| `npm run verify:errors` | Every failed save explains why in plain words |
| `npm run verify:forms` | The shared form rules (required, email, phone, zip, numbers, dates) and table widths |
| `npm run verify:event-schools` | An event's schools are counted one way everywhere (host plus participants, once each) |
| `npm run verify:no-deletes` | No code under `src/` deletes from the database |
| `npm run verify:no-names` | Visitors' names can't reach lists, exports or Reports |
| `npm run verify:reports-sql` | The SQL in `db/checks/reports_checks.sql` gives the same figures as the app. Not in CI: it needs a throwaway Postgres, set in `REPORTS_TEST_DATABASE_URL` |

Run all the CI checks locally before opening a pull request:

```bash
npm run lint && npm run build && npm run verify:import && npm run verify:activity-import \
  && npm run verify:reports && npm run verify:errors && npm run verify:forms \
  && npm run verify:event-schools && npm run verify:no-deletes && npm run verify:no-names
```

## Open items and proposals

Known issues that need an owner or a decision, and written-up proposals that aren't
built yet, are in [`db/README.md`](db/README.md) under **Open items** and **Proposals**,
next to the migration log.

---

## For staff

This part is for the people who use the app day to day.

**Importing activities (for example an event's attendance list)**

1. Go to **Import data → Activities** and click **Download template** if you need one.
   It has columns for school name, city and state, plus an optional Visitors count.
2. Choose the **activity type** and the **date** first. Pick the event if it's in the
   list, or choose "Other: type an event name" to add it.
3. Drop in your file (.xlsx, .xls or .csv). The app matches each row to a school.
4. **Review the matches** before saving: check the schools it found; for rows it was
   unsure about or couldn't match, search for the right school or leave them skipped;
   and decide about any archived schools it lists.
5. Save. The whole upload becomes one **batch** under Recent imports.

**Rolling back a bad import:** under Import data → Activities → Recent imports, find
the batch and click **Archive this batch**. Its activities leave the school pages and
Reports at once. Nothing is deleted: **Restore** on the same batch brings it back.

**Restoring something archived:** Settings → **Archived** lists archived schools,
contacts, events, programs and logged contacts, each with a Restore button. Archived
import batches are restored from Recent imports, as above.

**Reporting a problem:** click **Report a problem** at the bottom right of any page,
say what happened, and send. It records the page and your browser for us. Admins
read the reports in Settings → Problem reports.

**Who to contact:**

- **Access and roles** (for example becoming an editor): Dr. Christopher Gordon
  (cgordon@siue.edu), or any admin listed under Settings → Team.
- **Problems:** the **Report a problem** button on any page.
- **Maintainer:** Oluwaferanmi Odedairo (oodedai@siue.edu) until handoff.
- **Maintainer after handoff: _TO FILL IN: name and email of the person SIUE assigns._**
