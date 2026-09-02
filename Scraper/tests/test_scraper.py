import unittest
from datetime import date, timedelta

from models import Page, Resolution, School
from helpers import looks_like_person, normalized_role
from scraper import ContactParser, EventParser, SchoolScraper


class MemoryHttp:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, **kwargs):
        return self.pages.get(url, Page(url, url, 404, error="http_404"))


def target_school():
    return School(
        "IL:1",
        "Central High School",
        "IL",
        city="Springfield",
        phone="217-555-1000",
        administrator="Jordan Smith",
        administrator_title="Principal",
        directory_email="jordan@state.example",
        data_source="https://isbe.example/directory.xls",
    )


def resolution():
    return Resolution(
        status="resolved",
        seed_url="https://district.example/",
        fallback_url="https://district.example/",
        resolved_url="https://district.example/o/central",
        platform="apptegy",
    )


class ContactTests(unittest.TestCase):
    def test_missouri_prin_abbreviation_is_a_principal(self):
        self.assertEqual(normalized_role("Prin."), "principal")
        self.assertEqual(normalized_role("7-12 Princip"), "principal")

    def test_role_words_do_not_capture_names_or_assistants(self):
        self.assertEqual(normalized_role("Dean of Students"), "dean")
        self.assertEqual(normalized_role("Deanna Ligman"), "")
        self.assertEqual(normalized_role("Administrative Assistant to the Principal"), "")
        self.assertEqual(normalized_role("Administrator"), "administrator")
        self.assertEqual(normalized_role("Assistant Principal"), "assistant_principal")

    def test_non_people_are_rejected(self):
        for value in (
            "Chicago, IL 60602",
            "Counselor's Corner",
            "Academic Dean",
            "DCFS Hotline",
            "Departments Principals",
            "Manteno Schools",
            "Lake ESSC",
        ):
            self.assertFalse(looks_like_person(value), value)

    def test_tree_climb_returns_all_eight_valid_contacts(self):
        roles = (
            "Principal",
            "Assistant Principal",
            "Dean of Students",
            "School Counselor",
            "Guidance Counselor",
            "College and Career Counselor",
            "School Counselor",
            "Assistant Principal",
        )
        cards = "".join(
            f"<article class='staff-card'><h3>Person {chr(64 + index)}</h3>"
            f"<div>{role}</div><a href='mailto:person{index}@example.org'>Email</a></article>"
            for index, role in enumerate(roles, 1)
        )
        page = Page("https://district.example/o/central/staff", "https://district.example/o/central/staff", 200, cards, "text/html")
        contacts = ContactParser().extract(target_school(), resolution(), page, inherited_school=True)
        self.assertEqual(len(contacts), 8)
        self.assertTrue(all(contact.method == "repeated_staff_card" for contact in contacts))

    def test_accessible_email_label_supplies_the_real_name(self):
        html = """
        <div class='staff-list'>
          <article class='staff-card'><div>School Counselor</div>
          <a href='mailto:wendy@example.org'>Send email to Wendy Bivins</a></article>
          <article class='staff-card'><div>Principal</div>
          <a href='mailto:alex@example.org'>Send email to Alex Morgan</a></article>
        </div>
        """
        names = {item["name"] for item in ContactParser().cards(html)}
        self.assertEqual(names, {"Wendy Bivins", "Alex Morgan"})

    def test_embedded_json_contact_is_kept_under_verified_route(self):
        html = """
        <script type='application/json'>
        {"staff":[{"fullName":"Taylor Reed","jobTitle":"School Counselor",
        "emailAddress":"taylor@example.org","department":"Central High School"}]}
        </script>
        """
        page = Page("https://district.example/o/central/staff", "https://district.example/o/central/staff", 200, html, "text/html")
        contacts = ContactParser().extract(target_school(), resolution(), page, inherited_school=True)
        self.assertEqual([contact.name for contact in contacts], ["Taylor Reed"])
        self.assertEqual(contacts[0].method, "embedded_json")

    def test_authority_contact_survives_an_unresolved_site(self):
        unresolved = Resolution("unresolved", reason="no_valid_school_homepage")
        contacts = ContactParser.authority(target_school(), unresolved)
        self.assertEqual(len(contacts), 1)
        self.assertEqual(contacts[0].method, "official_state_record")
        self.assertLess(contacts[0].score, 7.0)


class EventTests(unittest.TestCase):
    def setUp(self):
        self.parser = EventParser()

    def test_sat_weekday_is_not_the_sat_exam(self):
        self.assertEqual(self.parser.category("Sat, August 22 - Office Open"), "")
        self.assertEqual(self.parser.category("SAT"), "testing")
        self.assertEqual(self.parser.category("Sat testing administration"), "testing")

    def test_ics_keeps_outreach_and_rejects_sports(self):
        future = (date.today() + timedelta(days=30)).strftime("%Y%m%d")
        text = f"""BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:College and Career Fair
DTSTART:{future}
LOCATION:Central High School
END:VEVENT
BEGIN:VEVENT
SUMMARY:Varsity Football Game
DTSTART:{future}
END:VEVENT
END:VCALENDAR"""
        page = Page("https://district.example/o/central/events.ics", "https://district.example/o/central/events.ics", 200, text, "text/calendar")
        events = self.parser.ics(target_school(), page, inherited_school=True)
        self.assertEqual([event.title for event in events], ["College and Career Fair"])

    def test_jsonld_college_night(self):
        future = (date.today() + timedelta(days=20)).isoformat()
        html = f"""<script type='application/ld+json'>{{"@type":"Event",
        "name":"College Night","startDate":"{future}T18:00:00",
        "location":"Central High School"}}</script>"""
        page = Page("https://district.example/o/central/events", "https://district.example/o/central/events", 200, html, "text/html")
        events = self.parser.structured(target_school(), page, inherited_school=True)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].category, "college_planning")


class ScraperIntegrationTests(unittest.TestCase):
    def test_verified_homepage_to_contacts_and_calendar(self):
        home = "https://district.example/o/central"
        staff = home + "/staff"
        calendar = home + "/events.ics"
        future = (date.today() + timedelta(days=45)).strftime("%Y%m%d")
        pages = {
            home: Page(home, home, 200, f"<title>Central High School</title><a href='{staff}'>Staff Directory</a><a href='{calendar}'>School Calendar</a>", "text/html"),
            staff: Page(staff, staff, 200, "<article class='staff-card'><h3>Alex Morgan</h3><p>Principal</p><a href='mailto:alex@example.org'>Email</a></article>", "text/html"),
            calendar: Page(calendar, calendar, 200, f"BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:College Fair\nDTSTART:{future}\nLOCATION:Central High School\nEND:VEVENT\nEND:VCALENDAR", "text/calendar"),
        }
        result = SchoolScraper(MemoryHttp(pages)).scrape(target_school(), resolution())
        self.assertIn("Alex Morgan", {contact.name for contact in result.contacts})
        self.assertEqual([event.title for event in result.events], ["College Fair"])
        self.assertIn(staff, result.contact_pages)
        self.assertIn(calendar, result.calendar_pages)


if __name__ == "__main__":
    unittest.main()
