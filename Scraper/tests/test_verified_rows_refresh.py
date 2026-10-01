import unittest

from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest


def run(phone, contact_phone):
    school = School("IL:1", "Central High", "IL", district_name="D", district_code="1",
                    county="Cook", phone=phone, city="Springfield")
    contact = Contact("Pat Lee", "Counselor", "counselor", email="plee@central.org",
                      phone=contact_phone, score=8.0, method="staff_card")
    return [SchoolResult(school, Resolution("resolved", resolved_url="https://example.org"), [contact])]


class VerifiedRowsRefreshTests(ThrowawayDatabaseTest):
    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def test_a_verified_school_and_contact_are_refreshed(self):
        self.write(run("217-555-0100", "217-555-0200"))
        self.run_sql("UPDATE schools SET is_verified = TRUE, is_scraped = TRUE")
        self.run_sql("UPDATE staff SET is_verified = TRUE")
        self.write(run("217-555-0199", "217-555-0299"))
        self.assertEqual(self.query("SELECT phone FROM schools"), [("217-555-0199",)])
        self.assertEqual(self.query("SELECT phone FROM staff"), [("217-555-0299",)])

    def test_a_client_edit_on_a_verified_row_still_wins(self):
        # Removing the whole-row freeze is safe because db/006 locks edited columns.
        self.write(run("217-555-0100", "217-555-0200"))
        self.run_sql("UPDATE schools SET is_verified = TRUE, is_scraped = TRUE")
        self.run_sql("UPDATE schools SET phone = '217-555-7777'", as_app=True)
        self.write(run("217-555-0199", "217-555-0200"))
        rows = self.query("SELECT phone, pending_scraped->'phone'->>'value' FROM schools")
        self.assertEqual(rows, [("217-555-7777", "217-555-0199")])


if __name__ == "__main__":
    unittest.main()
