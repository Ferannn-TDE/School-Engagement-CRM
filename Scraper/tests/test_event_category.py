import io
import unittest
from contextlib import redirect_stdout

from database import DatabaseRows, DatabaseWriter
from helpers import TESTING_DATE_CATEGORY
from models import Event, Resolution, School, SchoolResult
from scraper import EventParser
from tests.throwaway_db import ThrowawayDatabaseTest

CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1", county="Cook")


def event(title, category):
    return Event(title, "2099-10-01T18:00:00", start_local="2099-10-01T13:00:00", category=category, method="ics_feed")


def run(*events, external=()):
    return [SchoolResult(CENTRAL, Resolution("resolved", resolved_url="https://example.org"), [], list(events))], list(external)


def category_of(title):
    with redirect_stdout(io.StringIO()):
        return EventParser().category(title)


class EventCategoryRowsTests(unittest.TestCase):
    """Testing dates are stored as school_testing_date; everything else as outreach (no category)."""

    def test_rows_carry_the_category(self):
        results, _ = run(event("LHS - SAT testing all day", category_of("LHS - SAT testing all day")),
                         event("College Fair", category_of("College Fair")))
        rows = {row[7]: row for row in DatabaseRows(results).events()}
        self.assertEqual(rows["LHS - SAT testing all day"][-1], TESTING_DATE_CATEGORY)
        self.assertIsNone(rows["College Fair"][-1])

    def test_ap_counts_only_with_exam_or_test(self):
        self.assertEqual(category_of("AP Calculus Exam"), TESTING_DATE_CATEGORY)
        self.assertNotEqual(category_of("AP Celebration Day"), TESTING_DATE_CATEGORY)

    def test_iacac_fairs_are_outreach(self):
        fair = Event("IACAC College Fair", "2099-10-01T18:00:00", location="Chicago",
                     source_url="https://iacac.example/1", category="college_planning")
        results, external = run(external=[fair])
        row = next(r for r in DatabaseRows(results, external).events() if r[6].startswith("iacac:"))
        self.assertIsNone(row[-1])


class EventCategoryWriteTests(ThrowawayDatabaseTest):
    def write(self, *events):
        results, _ = run(*events)
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def categories(self):
        return dict(self.query("SELECT fair_name, category FROM events"))

    def test_a_testing_date_is_stored_with_its_category_and_outreach_without(self):
        self.write(event("ACT @ Summit all day", category_of("ACT @ Summit all day")),
                   event("AP Exams Begin", category_of("AP Exams Begin")),
                   event("College Night", category_of("College Night")))
        self.assertEqual(self.categories(), {"ACT @ Summit all day": TESTING_DATE_CATEGORY,
                                             "AP Exams Begin": TESTING_DATE_CATEGORY,
                                             "College Night": None})

    def test_an_update_sets_a_testing_date_but_never_clears_a_category(self):
        self.write(event("College Night", ""))
        self.run_sql("UPDATE events SET category = 'school_testing_date'")  # e.g. db/007 or a person
        self.write(event("College Night", ""))
        self.assertEqual(self.categories()["College Night"], TESTING_DATE_CATEGORY)


if __name__ == "__main__":
    unittest.main()
