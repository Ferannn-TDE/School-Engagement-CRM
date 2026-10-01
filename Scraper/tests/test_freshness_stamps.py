import tempfile
import unittest
from dataclasses import replace

from database import DatabaseWriter, source_status
from main import SchoolReach
from models import Contact, Resolution, School, SchoolResult
from tests.test_pipeline import CountingResolver, FakeDatabaseWriter, FakeRoster, FakeScraper, schools
from tests.throwaway_db import ThrowawayDatabaseTest

ALPHA = School("IL:1", "Alpha High", "IL", district_name="D", district_code="1", county="Cook")
BETA = School("IL:2", "Beta High", "IL", district_name="D", district_code="1", county="Cook")
PAT = Contact("Pat Lee", "Counselor", "counselor", email="plee@alpha.org", score=8.0, method="staff_card")
SAM = Contact("Sam Roe", "Principal", "principal", email="sroe@alpha.org", score=8.0, method="staff_card")


def found(school, *contacts, pages=("https://alpha.example/staff",), error=""):
    return SchoolResult(school, Resolution("resolved", resolved_url="https://alpha.example/"),
                        list(contacts), contact_pages=list(pages), error=error)


class FreshnessStampTests(ThrowawayDatabaseTest):
    """last_scraped_at, source_status and missed runs (db/011, Part 3)."""

    def write(self, results, complete=True):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert", complete=complete)

    def school(self, key="IL:1"):
        return self.query("SELECT last_scraped_at, source_status, source_checked_at, missed_runs, "
                          "missing_since, priority_tier FROM schools WHERE facility_key = %s", (key,))[0]

    def staff(self, email):
        return self.query("SELECT last_scraped_at, missed_runs, missing_since FROM staff WHERE email = %s", (email,))[0]

    def test_a_school_and_person_found_are_stamped_and_reset(self):
        self.write([found(ALPHA, PAT)])
        self.run_sql("UPDATE schools SET missed_runs = 3, missing_since = now() - interval '10 days'")
        self.run_sql("UPDATE staff SET missed_runs = 4, missing_since = now() - interval '10 days'")
        self.write([found(ALPHA, PAT)])
        scraped, status, checked, missed, missing, _ = self.school()
        self.assertIsNotNone(scraped)
        self.assertEqual((status, missed, missing), ("working", 0, None))
        self.assertIsNotNone(checked)
        self.assertEqual(self.staff("plee@alpha.org")[1:], (0, None))

    def test_the_lookup_result_no_longer_overwrites_the_clients_priority(self):
        self.write([found(ALPHA)])
        self.run_sql("UPDATE schools SET priority_tier = 'high'")
        self.write([found(ALPHA)])
        self.assertEqual(self.school()[5], "high")

    def test_a_school_missing_from_three_complete_runs_is_flagged_never_deleted(self):
        self.write([found(ALPHA), found(BETA)])
        for run in (1, 2):
            self.write([found(ALPHA)])
            self.assertEqual(self.school("IL:2")[3:5], (run, None))
        self.write([found(ALPHA)])
        missed, missing = self.school("IL:2")[3:5]
        self.assertEqual(missed, 3)
        self.assertIsNotNone(missing)
        self.assertEqual(self.query("SELECT count(*) FROM schools"), [(2,)])

    def test_an_incomplete_run_counts_nobody_as_missed(self):
        self.write([found(ALPHA), found(BETA)])
        self.write([found(ALPHA)], complete=False)
        self.assertEqual(self.school("IL:2")[3], 0)

    def test_staff_are_missed_only_where_the_staff_pages_were_read(self):
        self.write([found(ALPHA, PAT, SAM)])
        self.write([found(ALPHA, PAT)])  # pages read, Sam not there
        self.assertEqual(self.staff("sroe@alpha.org")[1], 1)
        self.write([found(ALPHA, pages=(), error="http_500")])  # site down: nobody counted
        self.assertEqual(self.staff("sroe@alpha.org")[1], 1)
        self.assertEqual(self.staff("plee@alpha.org")[1], 0)

    def test_archived_records_are_never_counted(self):
        self.write([found(ALPHA, PAT), found(BETA)])
        self.run_sql("UPDATE schools SET archived = true WHERE facility_key = 'IL:2'")
        self.write([found(ALPHA)])
        self.assertEqual(self.school("IL:2")[3], 0)


class SourceStatusTests(unittest.TestCase):
    def test_how_the_website_check_is_described(self):
        def r(**kw):
            return SchoolResult(ALPHA, Resolution(**kw))
        self.assertEqual(source_status(r(status="resolved", resolved_url="https://a/")), "working")
        self.assertEqual(source_status(r(status="error")), "broken")
        self.assertEqual(source_status(r(status="unresolved", reason="missing_official_seed")), "not_found")
        self.assertEqual(source_status(r(status="unresolved", trace=[{"error": "timeout"}])), "broken")
        self.assertEqual(source_status(r(status="unresolved", trace=[{"error": ""}])), "not_found")


class CompleteRunTests(unittest.TestCase):
    def test_only_a_run_over_the_whole_roster_is_complete(self):
        for skip, expected in ((0, True), (1, False)):
            writer = FakeDatabaseWriter()
            with tempfile.TemporaryDirectory() as folder:
                SchoolReach(FakeRoster(schools()), CountingResolver(), FakeScraper(), folder,
                            workers=1, skip=skip, database_writer=writer).run()
            self.assertIs(writer.complete, expected)


if __name__ == "__main__":
    unittest.main()
