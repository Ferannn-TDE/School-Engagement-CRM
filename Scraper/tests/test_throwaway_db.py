from tests.throwaway_db import ThrowawayDatabaseTest, throwaway_url
import os
import unittest


class HarnessTests(ThrowawayDatabaseTest):
    def test_tables_exist_and_the_edit_lock_is_installed(self):
        tables = {row[0] for row in self.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'scraper_test'"
        )}
        self.assertTrue({"district", "schools", "staff", "contacts", "events"} <= tables)
        triggers = self.query("SELECT count(*) FROM pg_trigger WHERE tgname = 'protect_manual_edits'")
        self.assertGreaterEqual(triggers[0][0], 2)


class SafetyTests(unittest.TestCase):
    def test_a_supabase_url_is_refused(self):
        previous = os.environ.get("SCRAPER_TEST_DATABASE_URL")
        os.environ["SCRAPER_TEST_DATABASE_URL"] = "postgresql://postgres@db.abc.supabase.co:5432/postgres"
        try:
            with self.assertRaises(RuntimeError):
                throwaway_url()
        finally:
            if previous is None:
                os.environ.pop("SCRAPER_TEST_DATABASE_URL")
            else:
                os.environ["SCRAPER_TEST_DATABASE_URL"] = previous


if __name__ == "__main__":
    unittest.main()
