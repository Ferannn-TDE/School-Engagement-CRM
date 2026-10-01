import unittest

from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest


def run(sch, *contacts):
    return [SchoolResult(sch, Resolution("resolved", resolved_url="https://example.org"), list(contacts))]


CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1", county="Cook")


def person(score):
    return Contact("Pat Lee", "Counselor", "counselor", email="plee@central.org", score=score, method="staff_card")


class ScoreHasItsOwnColumnTests(ThrowawayDatabaseTest):
    """The score goes to staff.scraper_score (db/014); notes belong to people (Part 3)."""

    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def row(self):
        return self.query("SELECT notes, scraper_score, scraper_score_at FROM staff")[0]

    def test_a_new_person_gets_the_score_in_its_column_and_no_note(self):
        self.write(run(CENTRAL, person(8.54)))
        notes, score, score_at = self.row()
        self.assertIsNone(notes)
        self.assertEqual(float(score), 8.54)
        self.assertIsNotNone(score_at)

    def test_a_persons_note_is_never_touched_and_the_score_updates(self):
        self.write(run(CENTRAL, person(8.5)))
        self.run_sql("UPDATE staff SET notes = 'Prefers email. Call after 3pm.'")
        self.write(run(CENTRAL, person(7.96)))
        notes, score, _ = self.row()
        self.assertEqual(notes, "Prefers email. Call after 3pm.")
        self.assertEqual(float(score), 7.96)

    def test_a_run_without_a_score_keeps_the_last_one(self):
        self.write(run(CENTRAL, person(8.5)))
        _, _, first_at = self.row()
        self.write(run(CENTRAL, person(None)))
        notes, score, score_at = self.row()
        self.assertIsNone(notes)
        self.assertEqual(float(score), 8.5)
        self.assertEqual(score_at, first_at)


if __name__ == "__main__":
    unittest.main()
