import unittest

from database import DatabaseWriter
from models import Contact, Resolution, School, SchoolResult
from tests.throwaway_db import ThrowawayDatabaseTest


def school(key, name):
    return School(key, name, "IL", district_name="Test District", district_code=key, county="Cook")


def result(sch, *contacts):
    return SchoolResult(sch, Resolution("resolved", resolved_url="https://example.org"), list(contacts))


def person(name, title, email="", phone=""):
    return Contact(name, title, "principal", email=email, phone=phone, method="staff_card", score=7.0)


class StaffMatchingTests(ThrowawayDatabaseTest):
    def write(self, *results):
        DatabaseWriter(self.url, connect=self.connect).write(list(results), "upsert")

    def staff_rows(self):
        return self.query("SELECT staff_id, name, job_name, school_worked_at, email FROM staff ORDER BY staff_id")

    def test_a_client_corrected_title_still_matches_the_same_person(self):
        # First run finds her with no email or phone, so name is all there is to go on.
        central = school("IL:1", "Central High")
        self.write(result(central, person("Maggie Nordsiek", "Social Worker")))
        [(staff_id, *_)] = self.staff_rows()

        # The client corrects her title in the app.
        self.run_sql("UPDATE staff SET job_name = 'School Social Worker' WHERE staff_id = %s",
                     (staff_id,), as_app=True)

        # Next run: the website still says "Social Worker". Before this fix, name + title
        # found nobody and a second Maggie Nordsiek was inserted.
        self.write(result(central, person("Maggie Nordsiek", "Social Worker")))
        rows = self.staff_rows()
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0][2], "School Social Worker")  # the client's title survives (db/006)

    def test_the_same_name_at_different_schools_stays_two_people(self):
        self.write(
            result(school("IL:1", "Central High"), person("Chris Smith", "Principal")),
            result(school("IL:2", "North High"), person("Chris Smith", "Principal")),
        )
        self.write(
            result(school("IL:1", "Central High"), person("Chris Smith", "Principal")),
            result(school("IL:2", "North High"), person("Chris Smith", "Principal")),
        )
        rows = self.staff_rows()
        self.assertEqual(len(rows), 2, rows)
        self.assertEqual({r[3] for r in rows}, {"IL:1", "IL:2"})

    def test_the_same_name_at_one_school_with_different_emails_stays_two_people(self):
        central = school("IL:1", "Central High")
        self.write(result(central,
                          person("Chris Smith", "Math Teacher", email="csmith@central.org"),
                          person("Chris Smith", "Counselor", email="christopher.smith@central.org")))
        self.write(result(central,
                          person("Chris Smith", "Math Teacher", email="csmith@central.org"),
                          person("Chris Smith", "Counselor", email="christopher.smith@central.org")))
        rows = self.staff_rows()
        self.assertEqual(len(rows), 2, rows)

    def test_a_new_email_is_attached_to_the_existing_record_found_by_name(self):
        # Found by name first (no email), then the website starts listing her email:
        # that is the same person gaining an email, not a new person.
        central = school("IL:1", "Central High")
        self.write(result(central, person("Maggie Nordsiek", "Social Worker")))
        self.write(result(central, person("Maggie Nordsiek", "Social Worker", email="mnordsiek@central.org")))
        rows = self.staff_rows()
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual(rows[0][4], "mnordsiek@central.org")


if __name__ == "__main__":
    unittest.main()
