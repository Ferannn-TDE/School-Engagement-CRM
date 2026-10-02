import unittest
from datetime import date, timedelta

from database import DatabaseRows, DatabaseWriter
from helpers import DISTRICT_SQL, EVENT_SQL, STAFF_SQL, STAFF_UPDATE_SQL
from models import Contact, Event, Resolution, School, SchoolResult


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

    def fetchall(self):
        return []

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
    def test_rows_leave_identity_ids_to_postgresql_and_the_score_has_its_own_column(self):
        values = DatabaseRows([result_fixture()])
        district_key, district_row = values.districts()[0]
        staff_key, staff_row = values.staff()[0]
        school_row = values.schools({district_key: 1})[0]

        self.assertEqual(values.states(), [("MO", "Missouri")])
        self.assertEqual(values.counties(), [("Jackson", "MO")])
        self.assertEqual(district_row, ("Central R-I", "Jackson", "MO"))
        self.assertEqual(school_row[0], "MO:001")
        self.assertEqual(school_row[2], 1)
        self.assertIsNone(staff_row[7])  # notes: never written by the scraper
        self.assertEqual(staff_row[13], 8.5)  # scraper_score (db/014)
        self.assertIs(staff_row[11], False)
        self.assertIsNone(staff_row[12])
        self.assertIs(school_row[20], False)
        self.assertIsNone(school_row[21])
        self.assertEqual(staff_key[0], "MO:001")
        self.assertTrue(values.events()[0][6].startswith("schoolreach:"))

    def test_replace_is_disabled_in_the_operational_writer(self):
        writer = DatabaseWriter("postgresql://example", connect=lambda _: FakeConnection([]))
        with self.assertRaisesRegex(ValueError, "upsert"):
            writer.write([result_fixture()], "replace")


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

    def test_upsert_never_deletes_or_truncates(self):
        # Restored from a copy of this test class that never ran: the file held the
        # whole class twice and Python kept only the second, so this safeguard was
        # silently skipped. The original also asserted that schools are never written,
        # which is no longer true (the writer upserts schools), so only the part that
        # still holds is kept: the scraper must never remove rows (no-loss rule,
        # plan: "the scraper never deletes rows").
        calls = []
        writer = DatabaseWriter("postgresql://example", connect=lambda _: FakeConnection(calls))
        writer.write([result_fixture()], "upsert")
        statements = [value[0] for _, value in calls]
        self.assertTrue(statements)
        self.assertFalse(any(s.lstrip().upper().startswith(("DELETE", "TRUNCATE")) for s in statements))

    def test_insert_sql_uses_database_generated_identity_ids(self):
        self.assertNotIn("district_id,", DISTRICT_SQL)
        self.assertNotIn("staff_id,", STAFF_SQL)
        self.assertNotIn("event_id,", EVENT_SQL)
        self.assertNotIn("OVERRIDING SYSTEM VALUE", STAFF_SQL)

if __name__ == "__main__":
    unittest.main()
