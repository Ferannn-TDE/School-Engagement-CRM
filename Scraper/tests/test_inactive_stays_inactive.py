import unittest

from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest

CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1", county="Cook")


def run(*contacts):
    return [SchoolResult(CENTRAL, Resolution("resolved", resolved_url="https://example.org"), list(contacts))]


PAT = Contact("Pat Lee", "Counselor", "counselor", email="plee@central.org", score=8.0, method="staff_card")


class InactiveStaysInactiveTests(ThrowawayDatabaseTest):
    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def test_a_deactivated_contact_stays_inactive(self):
        self.write(run(PAT))
        self.run_sql("UPDATE staff SET is_active = FALSE")
        self.write(run(PAT))
        self.assertEqual(self.query("SELECT is_active FROM staff"), [(False,)])

    def test_a_deactivated_school_stays_inactive(self):
        self.write(run(PAT))
        # The school upsert only updates unverified, scraped rows today.
        self.run_sql("UPDATE schools SET is_active = FALSE, is_verified = FALSE, is_scraped = TRUE")
        self.write(run(PAT))
        self.assertEqual(self.query("SELECT is_active FROM schools"), [(False,)])

    def test_active_records_stay_active(self):
        self.write(run(PAT))
        self.write(run(PAT))
        self.assertEqual(self.query("SELECT is_active FROM staff"), [(True,)])
        self.assertEqual(self.query("SELECT is_active FROM schools"), [(True,)])


if __name__ == "__main__":
    unittest.main()
