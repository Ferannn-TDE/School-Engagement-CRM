import unittest

from helpers import canonical_url, serves_high_school
from sources import IllinoisSource, MissouriSource


class SourceTests(unittest.TestCase):
    def test_missouri_protocol_damage_is_repaired(self):
        self.assertEqual(canonical_url("https//www.aurorar8.org"), "https://www.aurorar8.org/")
        self.assertEqual(canonical_url("http://https/www.aurorar8.org"), "https://www.aurorar8.org/")
        self.assertEqual(canonical_url("http://htt/legacy.example.org"), "http://legacy.example.org/")
        self.assertEqual(canonical_url("N/A"), "")

    def test_spaces_and_invalid_ports_are_contained(self):
        self.assertEqual(
            canonical_url("https://example.org/our schools/?name=North High"),
            "https://example.org/our%20schools/?name=North+High",
        )
        self.assertEqual(canonical_url("https://example.org:not-a-port/staff"), "")
        self.assertEqual(canonical_url("https://example.org:99999/staff"), "")
        self.assertEqual(canonical_url("https://example.org:8443/staff"), "https://example.org:8443/staff")

    def test_high_school_filter_handles_k12_and_rejects_junior_high(self):
        self.assertTrue(serves_high_school("Community School", "K-12"))
        self.assertTrue(serves_high_school("Central High School", "9-12"))
        self.assertFalse(serves_high_school("Central Junior High School", "6-9"))

    def test_illinois_rows_join_the_district_and_make_stable_keys(self):
        rows = [
            {
                "Region-2 County-3 District-4": "01-001-0001",
                "Type": "26",
                "School": "0000",
                "FacilityName": "Example Unit District",
                "Website": "district.example.org",
                "RecType": "Dist",
            },
            {
                "Region-2 County-3 District-4": "01-001-0001",
                "Type": "26",
                "School": "0001",
                "FacilityName": "North High School",
                "City": "Springfield",
                "CountyName": "Sangamon",
                "GradeServed": "9-12",
                "Telephone": "217-555-1000",
                "Administrator": "Jordan Smith",
                "Website": "north.example.org",
                "RecType": "Sch",
            },
            {
                "Region-2 County-3 District-4": "01-001-0001",
                "Type": "26",
                "School": "0002",
                "FacilityName": "South High School",
                "City": "Springfield",
                "GradeServed": "9-12",
                "RecType": "Sch",
            },
        ]
        schools = IllinoisSource().from_rows(rows)
        self.assertEqual(len(schools), 2)
        north = next(school for school in schools if school.name.startswith("North"))
        south = next(school for school in schools if school.name.startswith("South"))
        self.assertTrue(north.facility_key.startswith("IL:"))
        self.assertEqual(north.administrator_title, "Administrator")
        self.assertEqual(south.district_website, "https://district.example.org/")
        self.assertIn("South High School", north.peer_names)
        self.assertIn("https://district.example.org/", south.seeds)

    def test_missouri_joins_official_school_and_district_layers(self):
        district_rows = [{
            "CTYDIST": "001-090",
            "DNAME": "Aurora R-VIII",
            "DCOUNTY": "Lawrence",
            "URL": "https//www.aurorar8.org",
        }]
        school_rows = [
            {
                "SchID": "001090-1050",
                "Facility": "Aurora High",
                "CtyDist": "001090",
                "City": "Aurora",
                "County": "Lawrence",
                "Phone": "417-555-1000",
                "BGrade": "09",
                "EGrade": "12",
                "Principal": "Alex Morgan",
                "PrinTitle": "Principal",
                "Enrollment": 700,
            },
            {
                "SchID": "001090-2000",
                "Facility": "Aurora Elementary",
                "CtyDist": "001090",
                "BGrade": "KG",
                "EGrade": "05",
            },
        ]
        schools = MissouriSource().from_rows(school_rows, district_rows)
        self.assertEqual(len(schools), 1)
        school = schools[0]
        self.assertEqual(school.facility_key, "MO:001090-1050")
        self.assertEqual(school.website, "")
        self.assertEqual(school.district_website, "https://www.aurorar8.org/")
        self.assertEqual(school.enrollment, 700)

    def test_placeholder_ids_do_not_overwrite_each_other(self):
        rows = [
            {"FacilityName": "Alpha High School", "School": "0001", "Type": "26", "GradeServed": "9-12", "City": "Chicago", "RecType": "Sch"},
            {"FacilityName": "Beta High School", "School": "0002", "Type": "26", "GradeServed": "9-12", "City": "Chicago", "RecType": "Sch"},
        ]
        schools = IllinoisSource().from_rows(rows)
        self.assertEqual(len({school.facility_key for school in schools}), 2)
        self.assertTrue(all("generated" in school.facility_key for school in schools))


if __name__ == "__main__":
    unittest.main()
