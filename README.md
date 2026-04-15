# Cougar Connection — SIUE School of Engineering Engagement CRM

A web-based Customer Relationship Management system built for the **SIUE School of Engineering** to track K–12 outreach engagement. Manage school relationships, contacts, events, programs, and county-level analytics — all backed by a live Supabase cloud database.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend Framework | React | 19.2.0 |
| Language | TypeScript | 5.9.3 |
| Build Tool | Vite | 7.3.1 |
| Styling | Tailwind CSS v4 | 4.1.18 |
| Routing | React Router | 7.6.2 |
| Backend / Auth | Supabase | 2.101.0 |
| Table UI | TanStack Table | 8.21.3 |
| Charts | Recharts | 2.15.3 |
| Forms | React Hook Form + Zod | 7.56.1 + 3.24.2 |
| CSV Parsing | PapaParse | 5.5.3 |
| Excel Parsing | SheetJS (xlsx) | 0.18.5 |
| Date Utilities | date-fns | 4.1.0 |
| Icons | Lucide React | 0.511.0 |
| Notifications | react-hot-toast | 2.5.2 |

---

## Features

### Schools
- Full directory of K–12 schools with contact info, type (high school / middle school), county, address, priority tier, and verification status
- School detail pages with tabbed views: contacts, events, programs, and activity log
- Sortable, filterable, and paginated school table powered by TanStack Table
- Inline school name links to detail pages from every table in the app

### Contacts
- Staff directory linked to schools via a junction table
- Role classification: Teachers, Counselors, Administrators, STEM Coordinators, and more
- Verification status tracking; active/inactive toggle
- School links from every contact row for fast cross-navigation

### Events
- Monthly calendar view with today highlighted in blue
- List/table view with upcoming-first sort and filtering
- Event details include type, date, location, and list of participating schools
- Scraped events (from external sources) surfaced alongside manually-created events

### Programs
- Track SIUE outreach programs tied to schools and contacts
- Program types with start/end dates and descriptions

### Counties
- County-level overview cards showing schools, contacts, events, and programs per county
- Engagement rate badge (green ≥ 30%, amber ≥ 10%, red < 10%)
- County detail drill-down page with school table and full engagement breakdown
- Schools with no county data are excluded from county analytics with a visible data quality banner

### Analytics
- Dashboard metrics: total schools, contacts, events, programs
- Charts: engagement rate by county, county comparison, program coverage, contact role distribution
- Upcoming follow-ups panel with overdue/due-soon highlighting
- Powered by Supabase analytics views for accurate, query-efficient aggregation

### Generate Lists
- Filter contacts by county, role, school type, and event participation
- Export options: copy emails to clipboard, download full CSV, or generate mailing labels (.txt)
- Live preview table showing filtered contacts before export

### Import
- Bulk import schools and contacts from CSV or Excel files
- Column mapping UI to align source columns with CRM fields
- PapaParse (CSV) and SheetJS (Excel) for client-side parsing — no upload required

### Settings
- Export the full database to a JSON snapshot
- Import from a previously exported JSON backup
- Reset session to built-in demo seed data (live DB unaffected until reload)
- Account section with sign-out and current user display

---

## Project Structure

```
School-Engagement-CRM/
├── public/                      # Static assets
├── scraper/                     # Python K-12 data pipeline
│   ├── scraper.py               # Selenium + BeautifulSoup crawler
│   ├── nlp_processor.py         # spaCy NLP entity extractor
│   ├── db_writer.py             # Supabase insert layer
│   ├── settings.json            # Target URLs and run config
│   └── requirements.txt
├── src/
│   ├── components/
│   │   ├── common/              # Reusable UI primitives
│   │   │   ├── Badge.tsx
│   │   │   ├── Breadcrumb.tsx   # Parent > child nav (drill-down pages only)
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx         # Card + MetricCard
│   │   │   ├── ConfirmDialog.tsx
│   │   │   ├── DataTable.tsx    # TanStack Table wrapper
│   │   │   ├── EmptyState.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Select.tsx
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx    # Root layout shell
│   │   │   ├── Header.tsx       # Global search + breadcrumb header
│   │   │   └── Sidebar.tsx      # Nav links + SIUE branding
│   │   ├── schools/             # School-specific form components
│   │   ├── contacts/            # Contact form + detail panels
│   │   ├── events/              # Event form + calendar cells
│   │   └── programs/            # Program form components
│   ├── constants/
│   │   └── seedData.ts          # Demo dataset (not loaded at runtime)
│   ├── context/
│   │   ├── AppContext.tsx        # Global state — useReducer + Supabase fetch
│   │   └── AuthContext.tsx       # Supabase Auth session + AuthGuard
│   ├── hooks/                    # Custom React hooks
│   ├── pages/
│   │   ├── DashboardPage.tsx
│   │   ├── SchoolsPage.tsx
│   │   ├── SchoolDetailPage.tsx  # Breadcrumb: Schools > {name}
│   │   ├── ContactsPage.tsx
│   │   ├── EventsPage.tsx
│   │   ├── CountiesPage.tsx
│   │   ├── CountyDetailPage.tsx  # Breadcrumb: Counties > {county}
│   │   ├── AnalyticsPage.tsx
│   │   ├── GenerateListsPage.tsx
│   │   ├── ImportPage.tsx
│   │   └── SettingsPage.tsx
│   ├── services/                 # Supabase data access layer
│   │   ├── supabase.ts           # Supabase client init
│   │   ├── schoolsService.ts
│   │   ├── contactsService.ts
│   │   ├── eventsService.ts
│   │   ├── programsService.ts
│   │   ├── activitiesService.ts
│   │   └── analyticsService.ts   # Views + aggregation queries
│   ├── types/                    # TypeScript interfaces and enums
│   ├── utils/
│   │   ├── helpers.ts            # CSV export, date helpers
│   │   └── storage.ts            # JSON import/export utilities
│   ├── App.tsx                   # Route definitions
│   └── index.css                 # Tailwind v4 theme + SIUE brand tokens
├── .env                          # Local env vars (git-ignored)
├── .env.example
├── index.html
├── package.json
├── tsconfig.app.json
└── vite.config.ts
```

---

## Database Schema

All tables live in Supabase (PostgreSQL). The frontend service layer handles the mapping between database column names and frontend TypeScript field names.

### `schools`
| Column | Type | Notes |
|---|---|---|
| facility_key | text | Primary key — may contain slashes; always URL-encoded in links |
| name | text | School display name |
| school_type | text | `high_school` or `middle_school` |
| address | text | Street address |
| city | text | |
| state | text | |
| zip_code | text | |
| county | text | Used for county-level analytics; null excluded from aggregations |
| phone | text | |
| website | text | |
| is_verified | boolean | |
| priority_tier | text | `high`, `medium`, or `low` |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `staff` (contacts — person data)
| Column | Type | Notes |
|---|---|---|
| staff_id | integer | PK; cast to string for frontend `id` field |
| first_name | text | |
| last_name | text | |
| email | text | |
| phone | text | |
| role | text | Maps to `ContactRole` enum |
| is_active | boolean | |
| is_verified | boolean | |
| notes | text | |
| created_at | timestamptz | |

### `contacts` (junction — staff ↔ school)
| Column | Type | Notes |
|---|---|---|
| id | integer | PK |
| staff_id | integer | FK → staff.staff_id |
| facility_key | text | FK → schools.facility_key |
| is_primary | boolean | |
| created_at | timestamptz | |

### `events`
| Column | Type | Notes |
|---|---|---|
| id | integer | PK; frontend ID prefixed `e_<id>` |
| name | text | |
| event_type | text | Maps to `EventType` enum |
| date | date | |
| end_date | date | Optional |
| location | text | |
| description | text | |
| participating_schools | text[] | Array of facility_key values |
| created_at | timestamptz | |

### `programs`
| Column | Type | Notes |
|---|---|---|
| id | integer | PK |
| name | text | |
| program_type | text | |
| school_id | text | FK → schools.facility_key |
| contact_id | text | FK → staff.staff_id (as string) |
| start_date | date | |
| end_date | date | Optional |
| description | text | |
| created_at | timestamptz | |

### `activities`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| school_id | text | FK → schools.facility_key |
| type | text | Activity category |
| description | text | |
| date | date | |
| created_by | text | User email |
| created_at | timestamptz | |

### Analytics Views
| View | Purpose |
|---|---|
| `county_school_summary` | Per-county counts: schools, verified schools, contacts, events, programs |
| `county_engagement_rate` | Per-county: engaged school count + engagement percentage |
| `school_engagement_summary` | Per-school: event count, program count, last activity date |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project with the schema above applied

### Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd School-Engagement-CRM

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in your Supabase credentials (see Environment Variables)

# 4. Start the development server
npm run dev
# App available at http://localhost:5173

# 5. Build for production
npm run build
```

---

## Data Pipeline — Web Scraper

The `scraper/` directory contains a standalone Python pipeline for seeding the CRM with real school and staff data from public sources.

### Architecture

```
Target URLs (settings.json)
       ↓
scraper.py — Selenium + BeautifulSoup
  • Headless Chrome crawls school directory pages
  • Extracts raw HTML blocks per school
       ↓
nlp_processor.py — spaCy NLP
  • Named Entity Recognition for PERSON, ORG, GPE
  • Role classification via pattern matching on job title text
  • Produces structured {name, email, phone, role, school} records
       ↓
db_writer.py — Supabase Insert
  • Upserts schools by facility_key
  • Upserts staff records
  • Creates/updates contacts junction rows
```

### Running the Scraper

```bash
cd scraper
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# Configure target URLs and run options in settings.json
python scraper.py
```

> The scraper writes directly to Supabase. Always run against a non-production project first.

---

## Deployment

The app is a standard Vite SPA and deploys to any static host.

### Vercel (recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Set the following environment variables in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

Add a `vercel.json` to handle client-side routing:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL — e.g. `https://xyz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key — safe to expose client-side; Row Level Security enforces access |

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Roadmap

- [ ] Email integration — send outreach emails directly from contact pages
- [ ] Activity reminders — scheduled follow-up notifications
- [ ] Multi-user roles — admin vs. read-only staff accounts
- [ ] Map view — geographic visualization of school locations and engagement
- [ ] Bulk event creation — add multiple schools to an event at once
- [ ] Contact deduplication — merge duplicate staff records from scraper runs
- [ ] Dashboard customization — user-configurable metric widgets
- [ ] Export to Google Sheets — direct Sheets API integration

---

## Contributors

| Name | Role |
|---|---|
| SIUE School of Engineering | Product Owner |

---

*Built for SIUE School of Engineering — K-12 Outreach Program*
