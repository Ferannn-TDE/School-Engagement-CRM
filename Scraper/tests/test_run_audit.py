import csv
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import run_audit
from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import TEST_SCHEMA, ThrowawayDatabaseTest

BACKUP = TEST_SCHEMA + "_backup"
ALPHA = School("IL:1", "Alpha High", "IL", district_name="D", district_code="1", county="Cook", phone="618-555-0100")
PAT = Contact("Pat Lee", "Counselor", "counselor", email="plee@alpha.org", phone="618-555-0101", score=8.0, method="staff_card")


def found(school, *contacts):
    return [SchoolResult(school, Resolution("resolved", resolved_url="https://alpha.example/"), list(contacts),
                         contact_pages=["https://alpha.example/staff"])]


class RunAuditTests(ThrowawayDatabaseTest):
    """Every workflow run snapshots the tables first and lists what it changed (Part 3)."""

    def tearDown(self):
        if getattr(self, "url", None):
            with self.psycopg.connect(self.url, prepare_threshold=None) as conn:
                conn.execute(f"DROP SCHEMA IF EXISTS {BACKUP} CASCADE")
        super().tearDown()

    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert", complete=True)

    def snapshot(self, label="run_1_1"):
        return run_audit.snapshot(self.url, label, source=TEST_SCHEMA, backup=BACKUP, connection_factory=self.connect)

    def test_a_snapshot_copies_the_tables_and_refuses_to_overwrite(self):
        self.write(found(ALPHA, PAT))
        counts = self.snapshot()
        self.assertEqual(counts, {"schools": 1, "staff": 1, "contacts": 0, "events": 0})
        self.assertEqual(self.query(f"SELECT name, phone FROM {BACKUP}.scraper_run_run_1_1_staff"),
                         [("Pat Lee", "618-555-0101")])
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.snapshot()

    def test_the_change_list_names_every_changed_value_and_new_row(self):
        self.write(found(ALPHA, PAT))
        # As if the last run was a month ago, so this run's stamps differ.
        self.run_sql("UPDATE schools SET updated_at = now() - interval '30 days', "
                     "last_scraped_at = now() - interval '30 days'")
        self.snapshot()
        self.write(found(ALPHA, replace(PAT, phone="618-555-0199"),
                         Contact("Sam Roe", "Principal", "principal", email="sroe@alpha.org", score=7.0, method="staff_card")))
        lines, summary = run_audit.changes(self.url, "run_1_1", source=TEST_SCHEMA, backup=BACKUP,
                                           connection_factory=self.connect)
        phone = [l for l in lines if l[0] == "staff" and l[2] == "phone"]
        self.assertEqual(len(phone), 1)
        self.assertEqual((json.loads(phone[0][3]), json.loads(phone[0][4])), ("618-555-0101", "618-555-0199"))
        self.assertEqual(summary["staff"]["added"], 1)
        self.assertEqual(summary["schools"]["rows_changed"], 0)
        self.assertEqual(summary["schools"]["stamped_only"], 1)  # only updated_at / last_scraped_at
        with tempfile.TemporaryDirectory() as out:
            run_audit.write_changes(lines, summary, out)
            rows = list(csv.reader(open(Path(out) / "changes.csv")))
            self.assertEqual(rows[0], ["table", "key", "column", "before", "after"])
            self.assertTrue(json.loads((Path(out) / "changes_summary.json").read_text())["staff"]["added"])

    def test_labels_are_checked(self):
        with self.assertRaises(ValueError):
            run_audit.snapshot_table("run; drop table staff", "staff")


if __name__ == "__main__":
    unittest.main()
