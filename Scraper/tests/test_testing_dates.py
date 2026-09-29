import unittest
from datetime import date, timedelta

import helpers
from models import Page, School
from scraper import EventParser


class TestingDatesTests(unittest.TestCase):
    def setUp(self):
        self.parser = EventParser()

    def test_the_titles_found_in_the_live_data_are_testing_dates(self):
        # The 15 events matched in the live database on 2026-09-28.
        for title in [
            "LHS - SAT testing all day",
            "MHS - SAT Testing",
            "ACT @ Summit all day",
            "LHS - ACT Testing all day",
            "Horizon Practice SAT/PSAT (Gr. 9-11)",
            "PSAT/NMSQT (Optional Grade 11)",
            "9/10/11 Pre-ACT Testing Day No School for Seniors",
            "Registration Deadline for PSAT/NMSQT",
        ]:
            with self.subTest(title=title):
                self.assertEqual(self.parser.category(title), helpers.TESTING_DATE_CATEGORY)

    def test_saturday_and_look_alike_words_are_not_testing_dates(self):
        for title in ["Sat, August 22 - Office Open", "Activity Fair", "College and Career Fair",
                      "Tactical planning night"]:
            with self.subTest(title=title):
                self.assertNotEqual(self.parser.category(title), helpers.TESTING_DATE_CATEGORY)

    def test_every_match_is_logged(self):
        self.parser.category("LHS - SAT testing all day")
        self.parser.category("ACT @ Summit all day")
        self.assertEqual([term for term, _ in self.parser.testing_date_matches], ["SAT", "ACT"])

    def test_testing_dates_are_kept_not_skipped(self):
        # Other categories are required for an event to be kept; a testing date must
        # come through as an event, never be dropped.
        school = School("IL:1", "Lincoln High School", "IL")
        page = Page("https://example.org/cal", "https://example.org/cal", 200, "", "text/html")
        day = (date.today() + timedelta(days=20)).isoformat()
        event = self.parser.make(school, page, title="Lincoln High School SAT testing all day",
                                 start=day, method="ics_feed", inherited_school=True)
        self.assertIsNotNone(event)
        self.assertEqual(event.category, helpers.TESTING_DATE_CATEGORY)

    def test_the_list_is_the_single_place_to_edit(self):
        original = helpers.TESTING_DATE_TERMS[:]
        self.assertEqual(original, ["SAT", "ACT", "PSAT"])
        self.assertTrue(helpers.TESTING_DATE_PATTERN.search("PSAT day"))


if __name__ == "__main__":
    unittest.main()
