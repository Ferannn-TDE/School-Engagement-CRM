from types import SimpleNamespace
import unittest

from bs4 import BeautifulSoup

from helpers import ROLE_ORDER, normalized_role
from scraper import ContactParser, SchoolScraper


class InclusiveContactTests(unittest.TestCase):
    def test_student_support_roles_are_recognized(self):
        cases = {
            "College Access Advisor": "college_career",
            "School Social Worker": "social_worker",
            "School Social Worker, LCSW": "social_worker",
            "Director of Counseling": "counseling_lead",
            "Guidance Counselor": "counselor",
            "Graduation Coach": "graduation_transition",
            "Student Support Specialist": "student_support",
            "Enrollment Coordinator": "registrar",
            "Family Liaison": "family_liaison",
            "School Psychologist": "school_psychologist",
        }
        for title, role in cases.items():
            self.assertEqual(normalized_role(title), role)

    def test_student_facing_roles_rank_before_principals(self):
        self.assertLess(ROLE_ORDER.index("social_worker"), ROLE_ORDER.index("principal"))
        self.assertLess(ROLE_ORDER.index("college_career"), ROLE_ORDER.index("principal"))

    def test_non_outreach_roles_remain_rejected(self):
        self.assertEqual(normalized_role("Administrative Assistant"), "")
        self.assertEqual(normalized_role("Varsity Football Coach"), "")
        self.assertEqual(normalized_role("Superintendent"), "")

    def test_social_worker_card_is_extracted(self):
        soup = BeautifulSoup(
            '<article><h3>Alex Morgan</h3><p>School Social Worker</p>'
            '<a href="mailto:alex@example.org">Email</a></article>',
            "html.parser",
        )
        values = ContactParser.fields(soup.article)
        self.assertEqual(values["name"], "Alex Morgan")
        self.assertEqual(values["role"], "social_worker")

    def test_student_service_routes_are_guessed(self):
        resolution = SimpleNamespace(
            resolved_url="https://school.example/",
            platform="generic",
        )
        paths = SchoolScraper.guesses(resolution, "contact")
        self.assertIn("https://school.example/social-work", paths)
        self.assertIn("https://school.example/student-services", paths)


if __name__ == "__main__":
    unittest.main()
