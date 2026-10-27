/**
 * Proves db/checks/reports_checks.sql and src/utils/reports.ts define every Reports
 * figure the same way: loads the fixture (scripts/fixtures/reports) into a
 * throwaway Postgres, runs the SQL for several ranges, states and "today"s, and
 * compares each figure with reportSnapshot() on the same rows. Any difference fails.
 *
 * Opt-in, like the scraper's database tests: set REPORTS_TEST_DATABASE_URL to a
 * disposable database (needs psql on the PATH), e.g.
 *   REPORTS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres npm run verify:reports-sql
 * Without it, this skips. A Supabase URL is refused, so the live database is never
 * touched; everything happens in a private schema that is dropped afterwards.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { reportSnapshot, type DayRange } from '../src/utils/reports';
import { scopeToRegion, type Region } from '../src/utils/region';
import { loadFixtureRows, toAppData, type FixtureRows } from './reportsFixture';

const url = process.env.REPORTS_TEST_DATABASE_URL;
if (!url) {
  console.log('verify:reports-sql skipped: set REPORTS_TEST_DATABASE_URL to a throwaway Postgres to run it.');
  process.exit(0);
}
if (/supabase\.(co|com|net)/i.test(url)) {
  console.error('verify:reports-sql refuses a Supabase URL: use a throwaway database.');
  process.exit(1);
}

const SCHEMA = 'reports_test';
const psql = (sql: string) =>
  execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });

const lit = (v: unknown): string =>
  v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

function insert(table: string, rows: object[], columns: string[]): string {
  if (!rows.length) return '';
  const values = rows.map((r) => `(${columns.map((c) => lit((r as Record<string, unknown>)[c])).join(', ')})`).join(',\n  ');
  return `insert into ${table} (${columns.join(', ')}) values\n  ${values};\n`;
}

function setup(rows: FixtureRows): string {
  // The live tables' columns that the check reads, with their types.
  return `
drop schema if exists ${SCHEMA} cascade;
create schema ${SCHEMA};
set search_path to ${SCHEMA};
create table schools (facility_key text primary key, name text, state_code text, county_name text,
  archived boolean not null default false, source_status text);
create table activities (activity_id text primary key, school_id text, activity_type text not null, date date not null,
  archived boolean not null default false, import_batch_id text, attendee_count integer);
create table events (event_id integer primary key, fair_name text, date date, time time, schools_involved text,
  location text, category text, archived boolean not null default false);
create table staff (staff_id integer primary key, school_worked_at text, is_active boolean,
  archived boolean not null default false, last_verified_at timestamptz, last_scraped_at timestamptz);
create table contacts (school_id text, staff_id integer, archived boolean not null default false);
${insert('schools', rows.schools, ['facility_key', 'name', 'state_code', 'county_name', 'archived', 'source_status'])}
${insert('activities', rows.activities, ['activity_id', 'school_id', 'activity_type', 'date', 'archived', 'import_batch_id', 'attendee_count'])}
${insert('events', rows.events, ['event_id', 'fair_name', 'date', 'time', 'schools_involved', 'location', 'category', 'archived'])}
${insert('staff', rows.staff, ['staff_id', 'school_worked_at', 'is_active', 'archived', 'last_verified_at', 'last_scraped_at'])}
${insert('contacts', rows.contacts, ['school_id', 'staff_id', 'archived'])}
`;
}

const CHECK_SQL = readFileSync(join(process.cwd(), 'db', 'checks', 'reports_checks.sql'), 'utf8');

function runCheck(range: DayRange, today: string, region: Region): Record<string, number> {
  const lines = CHECK_SQL.split('\n');
  const marked = lines.map((l, i) => (l.includes('-- PARAMS') ? i : -1)).filter((i) => i >= 0);
  assert.equal(marked.length, 2, 'the params lines in reports_checks.sql are marked "-- PARAMS"');
  lines[marked[0]] = `  select date '${range.start}' as range_start, date '${range.end}' as range_end,`;
  lines[marked[1]] = `         date '${today}' as today, '${region}'::text as region,`;
  const out = psql(`set search_path to ${SCHEMA};\nset timezone to 'America/Chicago';\n${lines.join('\n')}`);
  return JSON.parse(out);
}

const CASES: { name: string; range: DayRange; today: string; region: Region }[] = [
  { name: 'Fall 2026 so far, All', range: { start: '2026-08-24', end: '2026-10-27' }, today: '2026-10-27', region: '' },
  { name: 'Fall 2026 so far, IL', range: { start: '2026-08-24', end: '2026-10-27' }, today: '2026-10-27', region: 'IL' },
  { name: 'Fall 2026 so far, MO', range: { start: '2026-08-24', end: '2026-10-27' }, today: '2026-10-27', region: 'MO' },
  { name: 'School year so far, All', range: { start: '2026-08-01', end: '2026-10-27' }, today: '2026-10-27', region: '' },
  { name: 'October 2026, All', range: { start: '2026-10-01', end: '2026-10-27' }, today: '2026-10-27', region: '' },
  { name: 'Fall 2026 whole, seen from Dec 25 (windows closed)', range: { start: '2026-08-24', end: '2026-12-18' }, today: '2026-12-25', region: '' },
  { name: 'Custom: spring 2026, MO', range: { start: '2026-03-01', end: '2026-04-30' }, today: '2026-10-27', region: 'MO' },
  { name: 'Custom: two years, All', range: { start: '2025-01-01', end: '2026-12-31' }, today: '2026-10-27', region: '' },
];

const rows = loadFixtureRows();
let failed = 0;
try {
  psql(setup(rows));
  for (const c of CASES) {
    const ts = reportSnapshot(scopeToRegion(toAppData(rows, c.today), c.region), c.range, c.today);
    const sql = runCheck(c.range, c.today, c.region);
    const keys = [...new Set([...Object.keys(ts), ...Object.keys(sql)])].sort();
    const diffs = keys.filter((k) => ts[k] !== sql[k]).map((k) => `${k}: page ${ts[k] ?? '(missing)'}, SQL ${sql[k] ?? '(missing)'}`);
    if (diffs.length) {
      failed++;
      console.log(`  FAIL ${c.name}\n       ${diffs.join('\n       ')}`);
    } else {
      console.log(`  ok   ${c.name} (${keys.length} figures agree)`);
    }
  }
} finally {
  psql(`drop schema if exists ${SCHEMA} cascade;`);
}
console.log(`\n${CASES.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
