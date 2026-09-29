"""Opt-in tests against a real, throwaway PostgreSQL database.

Some scraper fixes live in SQL (helpers.py *_SQL), and the fake cursor in
test_database.py can only check which values are sent, not what PostgreSQL does
with them. Tests that need real SQL use this module.

Set SCRAPER_TEST_DATABASE_URL to a disposable database, for example a local
PGlite server:
    npx @electric-sql/pglite-socket --db=memory:// --port=55432
    SCRAPER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres pytest
Without it, these tests are skipped.

Safety: the URL is refused if it points at Supabase, so the live database can never
be used by accident (plan: "never run the scraper against the live database").
Every test builds its tables fresh in a private schema and removes that schema
afterwards; nothing outside it is touched.
"""

import os
import unittest

TEST_SCHEMA = "scraper_test"

# The live tables' columns (as of db/006), limited to what the scraper touches.
SCHEMA_SQL = f"""
DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE;
CREATE SCHEMA {TEST_SCHEMA};
SET search_path TO {TEST_SCHEMA};

CREATE TABLE district (
    district_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    district_name text, county_name text, state_code text
);

CREATE TABLE schools (
    facility_key text PRIMARY KEY, name text, district_id integer, phone text,
    address text, class_size integer, rating numeric, type_of_school text, admin text,
    city text, zipcode text, grades_served text, website text, county_name text,
    is_scraped boolean, is_active boolean, notes text,
    created_at timestamptz, updated_at timestamptz, enrollment integer,
    grade_range text, data_source text, is_verified boolean,
    last_verified_at timestamptz, priority_tier text, state_code text,
    manual_fields text[] NOT NULL DEFAULT '{{}}',
    pending_scraped jsonb NOT NULL DEFAULT '{{}}'
);

CREATE TABLE staff (
    staff_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text, phone text, email text, job_name text, school_worked_at text,
    is_scraped boolean, is_active boolean, notes text,
    created_at timestamptz, updated_at timestamptz, data_source text,
    is_verified boolean, last_verified_at timestamptz,
    manual_fields text[] NOT NULL DEFAULT '{{}}',
    pending_scraped jsonb NOT NULL DEFAULT '{{}}'
);

CREATE TABLE contacts (school_id text, staff_id integer);

CREATE TABLE events (
    event_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schools_involved text, location text, time time, date date, attendance integer,
    is_scraped boolean, external_id text UNIQUE, fair_name text,
    created_at timestamptz, updated_at timestamptz
);
"""

# The edit lock from db/006, so tests see the same behaviour as the live database.
LOCK_SQL = """
CREATE OR REPLACE FUNCTION protect_manual_edits() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  from_app boolean := coalesce(current_setting('request.jwt.claims', true), '') <> '';
  protected text[] := tg_argv::text[];
  new_row jsonb := to_jsonb(new);
  old_row jsonb := to_jsonb(old);
  pending jsonb := old.pending_scraped;
  col text;
BEGIN
  IF from_app THEN
    FOREACH col IN ARRAY protected LOOP
      IF new_row -> col IS DISTINCT FROM old_row -> col AND NOT (col = ANY (new.manual_fields)) THEN
        new.manual_fields := array_append(new.manual_fields, col);
      END IF;
    END LOOP;
    RETURN new;
  END IF;
  FOREACH col IN ARRAY old.manual_fields LOOP
    IF new_row -> col IS DISTINCT FROM old_row -> col THEN
      pending := pending || jsonb_build_object(col, jsonb_build_object('value', new_row -> col, 'seen_at', now()));
      new_row := jsonb_set(new_row, ARRAY[col], old_row -> col);
    END IF;
  END LOOP;
  new := jsonb_populate_record(new, new_row);
  new.manual_fields := old.manual_fields;
  new.pending_scraped := pending;
  RETURN new;
END;
$fn$;
CREATE TRIGGER protect_manual_edits BEFORE UPDATE ON schools FOR EACH ROW
  EXECUTE FUNCTION protect_manual_edits('name', 'phone', 'address', 'type_of_school', 'admin',
    'city', 'zipcode', 'grades_served', 'website', 'county_name', 'is_active', 'notes',
    'enrollment', 'grade_range', 'priority_tier', 'state_code');
CREATE TRIGGER protect_manual_edits BEFORE UPDATE ON staff FOR EACH ROW
  EXECUTE FUNCTION protect_manual_edits('name', 'phone', 'email', 'job_name',
    'school_worked_at', 'is_active', 'notes');
"""


def throwaway_url():
    url = os.environ.get("SCRAPER_TEST_DATABASE_URL", "")
    if not url:
        return None
    if "supabase" in url.lower():
        raise RuntimeError(
            "SCRAPER_TEST_DATABASE_URL points at Supabase. These tests create and drop "
            "tables and must only ever run against a disposable database."
        )
    return url


class ThrowawayDatabaseTest(unittest.TestCase):
    """Builds fresh tables before each test and removes them after."""

    def setUp(self):
        url = throwaway_url()
        if url is None:
            self.skipTest("SCRAPER_TEST_DATABASE_URL not set; skipping real-SQL test")
        import psycopg

        self.url = url
        self.psycopg = psycopg
        with self.connect() as conn:
            conn.execute(SCHEMA_SQL)
            conn.execute(LOCK_SQL)

    def tearDown(self):
        if getattr(self, "url", None):
            with self.psycopg.connect(self.url) as conn:
                conn.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")

    def connect(self, _url=None):
        conn = self.psycopg.connect(self.url, connect_timeout=10)
        conn.execute(f"SET search_path TO {TEST_SCHEMA}")
        return conn

    def query(self, sql, params=None):
        with self.connect() as conn:
            return conn.execute(sql, params).fetchall()

    def run_sql(self, sql, params=None, *, as_app=False):
        """Runs one statement. as_app=True sets sign-in claims, like an app edit."""
        with self.connect() as conn:
            if as_app:
                conn.execute("SELECT set_config('request.jwt.claims', '{\"sub\":\"test\"}', true)")
            conn.execute(sql, params)
