import unittest

from contact_quality import ContactTitleNormalizer
from models import Contact, Resolution, School, SchoolResult


class ContactTitleNormalizerTests(unittest.TestCase):
    def setUp(self):
        self.gate = ContactTitleNormalizer()

    def contact(self, title, role="assistant_principal", name="Alex Morgan"):
        return Contact(name, title, role, email="alex@example.org", score=8.5)

    def test_defensible_abbreviations_are_normalized(self):
        contact, reason, changed = self.gate.decision(self.contact("Asst. Prin."))
        self.assertEqual(reason, "accepted")
        self.assertTrue(changed)
        self.assertEqual(contact.title, "Assistant Principal")
        self.assertEqual(contact.role, "assistant_principal")

    def test_associate_title_is_not_changed_to_assistant(self):
        contact, _, _ = self.gate.decision(self.contact("Associate Principal"))
        self.assertEqual(contact.title, "Associate Principal")

    def test_page_copy_is_rejected_instead_of_fabricating_a_title(self):
        contact, reason, _ = self.gate.decision(self.contact(
            "It is with great excitement that I serve as your Assistant Principal and support every student."
        ))
        self.assertIsNone(contact)
        self.assertIn(reason, {"sentence_not_title", "title_too_long"})

    def test_different_person_embedded_in_title_is_rejected(self):
        contact, reason, _ = self.gate.decision(
            self.contact("Jordan Smith, Assistant Principal")
        )
        self.assertIsNone(contact)
        self.assertEqual(reason, "different_person_in_title")

    def test_process_reports_accepted_normalized_and_rejected_counts(self):
        result = SchoolResult(
            School("IL:1", "Alpha High School", "IL"),
            Resolution("unresolved"),
            contacts=[
                self.contact("Asst. Prin."),
                self.contact("Data Warehouse - Principal Dashboard", role="principal", name="Quick Links"),
            ],
        )
        report = self.gate.process([result])
        self.assertEqual(report["input_contacts"], 2)
        self.assertEqual(report["accepted_contacts"], 1)
        self.assertEqual(report["normalized_titles"], 1)
        self.assertEqual(report["rejected_contacts"], 1)


if __name__ == "__main__":
    unittest.main()
