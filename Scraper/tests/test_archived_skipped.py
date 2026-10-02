import unittest
from dataclasses import replace

from database import DatabaseWriter
from main import without_archived
from models import Contact, Event, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest

CENTRAL = School("IL:1", "Central High", "IL", district_name="D", district_code="1",
                 county="Cook", phone="618-555-0100")
PAT = Contact("Pat Lee", "Counselor", "counselor", email="plee@central.org", score=8.0, method="staff_card")


def run(school, *contacts, events=()):
    return [SchoolResult(school, Resolution("resolved", resolved_url="https://example.org"),
                         list(contacts), list(events))]


class ArchivedRecordsAreLeftAloneTests(ThrowawayDatabaseTest):
    """Archived schools, their staff and archived people/events are never written (Part 3)."""

    def write(self, results):
        DatabaseWriter(self.url, connect=self.connect).write(results, "upsert")

    def test_an_archived_school_is_not_updated_and_gets_no_new_staff(self):
        self.write(run(CENTRAL))
        self.run_sql("UPDATE schools SET archived = true")
        self.write(run(replace(CENTRAL, phone="618-555-0199"), PAT))
        self.assertEqual(self.query("SELECT phone FROM schools"), [("618-555-0100",)])
        self.assertEqual(self.query("SELECT count(*) FROM staff"), [(0,)])

    def test_an_archived_person_is_neither_updated_nor_added_again(self):
        self.write(run(CENTRAL, PAT))
        self.run_sql("UPDATE staff SET archived = true")
        self.write(run(CENTRAL, replace(PAT, phone="618-555-0123")))
        self.assertEqual(self.query("SELECT count(*), max(phone) FROM staff"), [(1, None)])

    def test_the_active_record_is_preferred_over_an_archived_duplicate(self):
        self.write(run(CENTRAL))
        # An archived duplicate (lower id) and the active person, same email.
        self.run_sql("INSERT INTO staff (name, email, school_worked_at, is_scraped, archived) "
                     "VALUES ('Pat Lee', 'plee@central.org', 'IL:1', true, true)")
        self.run_sql("INSERT INTO staff (name, email, school_worked_at, is_scraped, archived) "
                     "VALUES ('Pat Lee', 'plee@central.org', 'IL:1', true, false)")
        self.write(run(CENTRAL, replace(PAT, phone="618-555-0123")))
        rows = self.query("SELECT archived, phone FROM staff ORDER BY staff_id")
        self.assertEqual(rows, [(True, None), (False, "618-555-0123")])

    def test_an_archived_event_is_not_updated(self):
        event = Event("College Fair", "2099-10-01T18:00:00", start_local="2099-10-01T13:00:00",
                      category="college_planning", method="ics_feed")
        self.write(run(CENTRAL, events=[event]))
        self.run_sql("UPDATE events SET archived = true, fair_name = 'Kept as it was'")
        self.write(run(CENTRAL, events=[event]))
        self.assertEqual(self.query("SELECT fair_name FROM events"), [("Kept as it was",)])


class RunSkipsArchivedSchoolsTests(unittest.TestCase):
    def test_archived_schools_are_not_scraped(self):
        schools = [School("IL:1", "Alpha", "IL"), School("IL:2", "Beta", "IL")]
        kept, skipped = without_archived(schools, {"IL:2": {"archived": True}})
        self.assertEqual([s.facility_key for s in kept], ["IL:1"])
        self.assertEqual(skipped, 1)


if __name__ == "__main__":
    unittest.main()
