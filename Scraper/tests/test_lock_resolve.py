import unittest
from dataclasses import replace

from database import DatabaseWriter
from models import Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest

CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1",
                 county="Cook", phone="618-555-0100")


def run(school):
    return [SchoolResult(school, Resolution("resolved", resolved_url="https://example.org"), [])]


class LockResolveTests(ThrowawayDatabaseTest):
    """The scraper's real writes against the db/012 edit lock (keep yours / use this)."""

    def write(self, school):
        DatabaseWriter(self.url, connect=self.connect).write(run(school), "upsert")

    def row(self):
        return self.query("SELECT phone, manual_fields, pending_scraped FROM schools")[0]

    def setUp(self):
        super().setUp()
        self.write(CENTRAL)
        # The client corrects the phone in the app: the field locks.
        self.run_sql("UPDATE schools SET phone = '618-555-0199'", as_app=True)

    def test_a_dismissed_value_is_not_asked_again_while_the_website_keeps_it(self):
        self.write(replace(CENTRAL, phone="618-555-0100"))
        # "Keep yours" in the app.
        self.run_sql(
            """UPDATE schools SET pending_scraped = jsonb_set(pending_scraped, '{phone}',
                 pending_scraped->'phone' || '{"dismissed": true}'::jsonb)""",
            as_app=True,
        )
        self.write(replace(CENTRAL, phone="618-555-0100"))
        phone, locked, pending = self.row()
        self.assertEqual(phone, "618-555-0199")
        self.assertEqual(locked, ["phone"])
        self.assertTrue(pending["phone"]["dismissed"])

    def test_a_new_value_from_the_website_asks_again(self):
        self.write(replace(CENTRAL, phone="618-555-0100"))
        self.run_sql(
            """UPDATE schools SET pending_scraped = jsonb_set(pending_scraped, '{phone}',
                 pending_scraped->'phone' || '{"dismissed": true}'::jsonb)""",
            as_app=True,
        )
        self.write(replace(CENTRAL, phone="618-555-0123"))
        _, _, pending = self.row()
        self.assertEqual(pending["phone"]["value"], "618-555-0123")
        self.assertNotIn("dismissed", pending["phone"])

    def test_using_the_websites_value_unlocks_the_field_for_the_scraper(self):
        self.write(replace(CENTRAL, phone="618-555-0100"))
        # "Use this" in the app.
        self.run_sql(
            """UPDATE schools SET phone = pending_scraped->'phone'->>'value',
                 pending_scraped = pending_scraped - 'phone'""",
            as_app=True,
        )
        self.assertEqual(self.row(), ("618-555-0100", [], {}))
        self.write(replace(CENTRAL, phone="618-555-0142"))
        self.assertEqual(self.row()[0], "618-555-0142")


if __name__ == "__main__":
    unittest.main()
