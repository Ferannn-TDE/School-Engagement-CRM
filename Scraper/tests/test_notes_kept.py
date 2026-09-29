import unittest

from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest


def run(sch, *contacts):
    return [SchoolResult(sch, Resolution("resolved", resolved_url="https://example.org"), list(contacts))]


CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1", county="Cook")


def person(score):
    return Contact("Pat Lee", "Counselor", "counselor", email="plee@central.org", score=score, method="staff_card")


class NotesAreNeverReplacedTests(ThrowawayDatabaseTest):
    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def notes(self):
        return self.query("SELECT notes FROM staff")[0][0]

    def test_a_persons_note_is_kept_and_the_scrapers_is_added(self):
        self.write(run(CENTRAL, person(8.5)))
        # Someone writes a note outside the app (so no edit lock applies).
        self.run_sql("UPDATE staff SET notes = 'Prefers email. Call after 3pm.'")
        self.write(run(CENTRAL, person(8.5)))
        self.assertEqual(self.notes(), "Prefers email. Call after 3pm.\n8.5")

    def test_an_empty_note_from_the_scraper_keeps_the_existing_one(self):
        self.write(run(CENTRAL, person(8.5)))
        self.run_sql("UPDATE staff SET notes = 'Prefers email.'")
        self.write(run(CENTRAL, person(None)))  # score_text(None) -> no note
        self.assertEqual(self.notes(), "Prefers email.")

    def test_the_same_note_is_not_repeated(self):
        self.write(run(CENTRAL, person(8.5)))
        self.write(run(CENTRAL, person(8.5)))
        self.write(run(CENTRAL, person(8.5)))
        self.assertEqual(self.notes(), "8.5")


if __name__ == "__main__":
    unittest.main()
