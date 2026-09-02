import unittest
from datetime import date, timedelta

from database import DatabaseRows, DatabaseWriter
from helpers import DISTRICT_SQL, EVENT_SQL, STAFF_SQL, STAFF_UPDATE_SQL
from models import Contact, Event, Resolution, School, SchoolResult
from refresh_database import refresh


def result_fixture():
    school = School(
        "MO:001",
        "Central High School",
        "MO",
        district_name="Central R-I",
        district_code="001",
        city="Central",
        county="Jackson",
        grades="9-12",
        phone="417-555-1000",
        administrator="Alex Morgan",
        data_source="https://gis.mo.gov/official",
    )
    resolution = Resolution(
        "resolved",
        "https://district.example/",
        "https://district.example/",
        "https://district.example/o/central",
        "named_school_link",
    )
    contact = Contact(
        "Alex Morgan",
        "Principal",
        "principal",
        "alex@example.org",
        "417-555-1000",
        source_url="https://district.example/o/central/staff",
        method="staff_card",
        assignment_score=9.0,
        score=8.5,
    )
    event = Event(
        "College Fair",
        (date.today() + timedelta(days=30)).isoformat() + "T18:00:00",
        location="Central High School",
        category="college_planning",
        method="ics_feed",
    )
    return SchoolResult(school, resolution, [contact], [event])


class FakeCursor:
    def __init__(self, calls):
        self.calls = calls
        self.next_row = None
        self.identities = {"district": 0, "staff": 0}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.calls.append(("execute", (normalized, params)))
        self.next_row = None
        if normalized.startswith("INSERT INTO district"):
            self.identities["district"] += 1
            self.next_row = (self.identities["district"],)
        elif normalized.startswith("INSERT INTO staff"):
            self.identities["staff"] += 1
            self.next_row = (self.identities["staff"],)

    def fetchone(self):
        row = self.next_row
        self.next_row = None
        return row

    def executemany(self, sql, rows):
        self.calls.append(("executemany", (" ".join(sql.split()), list(rows))))


class FakeConnection:
    def __init__(self, calls):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def cursor(self):
        return FakeCursor(self.calls)


class DatabaseTests(unittest.TestCase):
    def test_rows_leave_identity_ids_to_postgresql_and_notes_only_store_score(self):
        values = DatabaseRows([result_fixture()])
        district_key, district_row = values.districts()[0]
        staff_key, staff_row = values.staff()[0]
        school_row = values.schools({district_key: 1})[0]

        self.assertEqual(values.states(), [("MO", "Missouri")])
        self.assertEqual(values.counties(), [("Jackson", "MO")])
        self.assertEqual(district_row, ("Central R-I", "Jackson", "MO"))
        self.assertEqual(school_row[0], "MO:001")
        self.assertEqual(school_row[2], 1)
        self.assertEqual(staff_row[7], '{"score": 8.5}')
        self.assertIs(staff_row[11], False)
        self.assertIsNone(staff_row[12])
        self.assertEqual(staff_key[0], "MO:001")
        self.assertTrue(values.events()[0][6].startswith("schoolreach:"))

    def test_replace_is_disabled_in_the_operational_writer(self):
        writer = DatabaseWriter("postgresql://example", connect=lambda _: FakeConnection([]))
        with self.assertRaisesRegex(ValueError, "refresh_database.py"):
            writer.write([result_fixture()], "replace")

    def test_upsert_never_runs_a_delete(self):
        calls = []
        writer = DatabaseWriter("postgresql://example", connect=lambda _: FakeConnection(calls))
        writer.write([result_fixture()], "upsert")
        statements = [value[0] for kind, value in calls if kind == "execute"]
        statements += [value[0] for kind, value in calls if kind == "executemany"]
        writes = [
            statement for statement in statements
            if statement.startswith(("INSERT", "UPDATE", "DELETE", "TRUNCATE"))
        ]
        self.assertTrue(all(
            " staff " in f" {statement} " or " events " in f" {statement} "
            for statement in writes
        ))
        self.assertFalse(any(
            " schools " in f" {statement} " or " contacts " in f" {statement} "
            for statement in writes
        ))
        self.assertIn(
            "AND is_scraped IS TRUE",
            STAFF_UPDATE_SQL,
        )
        self.assertIn("NOT COALESCE(is_verified, FALSE)", STAFF_UPDATE_SQL)
        self.assertIn("WHERE events.is_scraped IS TRUE", EVENT_SQL)

    def test_iacac_events_are_global_rows_with_stable_source_ids(self):
        external = Event(
            "IACAC Regional College Fair",
            (date.today() + timedelta(days=45)).isoformat() + "T17:30:00",
            location="Convention Center",
            source_url="https://iacac.example/fair/record-1",
            method="iacac_knack_api",
        )
        rows = DatabaseRows([result_fixture()], external_events=[external]).events()
        row = next(item for item in rows if item[6].startswith("iacac:"))
        self.assertIsNone(row[0])
        self.assertTrue(row[6].startswith("iacac:"))

    def test_insert_sql_uses_database_generated_identity_ids(self):
        self.assertNotIn("district_id,", DISTRICT_SQL)
        self.assertNotIn("staff_id,", STAFF_SQL)
        self.assertNotIn("event_id,", EVENT_SQL)
        self.assertNotIn("OVERRIDING SYSTEM VALUE", STAFF_SQL)

    def test_confirmed_refresh_resets_identities_and_rebuilds_relationships(self):
        calls = []
        refresh(
            "postgresql://example",
            [result_fixture()],
            connect=lambda _: FakeConnection(calls),
        )
        statements = [value[0] for kind, value in calls if kind == "execute"]
        self.assertTrue(statements[0].startswith("TRUNCATE TABLE"))
        self.assertIn("RESTART IDENTITY CASCADE", statements[0])
        batches = [value for kind, value in calls if kind == "executemany"]
        contacts = next(rows for sql, rows in batches if "INSERT INTO contacts" in sql)
        self.assertEqual(contacts, [("MO:001", 1)])


if __name__ == "__main__":
    unittest.main()
