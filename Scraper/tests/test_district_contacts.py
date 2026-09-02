import unittest

from models import Page, Resolution, School
from scraper import SchoolScraper


class MemoryHttp:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, **kwargs):
        return self.pages.get(url, Page(url, url, 404, error="http_404"))


def school():
    return School(
        "MO:1",
        "Central High School",
        "MO",
        district_name="Example R-III",
        district_website="https://district.example/",
        phone="417-555-1000",
        administrator="Jordan Smith",
        administrator_title="Principal",
        directory_email="jordan@district.example",
        data_source="https://state.example/schools.json",
        peer_names=("Central Middle School", "West High School"),
    )


def unresolved():
    return Resolution(
        status="unresolved",
        seed_url="https://district.example/",
        fallback_url="https://district.example/",
        reason="district_found_but_no_valid_school_route",
        trace=[{
            "url": "https://district.example/",
            "final_url": "https://district.example/",
            "scope": "district",
            "error": "",
        }],
    )


class DistrictContactTests(unittest.TestCase):
    def test_target_principal_is_kept_as_low_score_review_contact(self):
        home = "https://district.example/"
        staff = "https://district.example/staff-directory"
        pages = {
            home: Page(home, home, 200, f"<a href='{staff}'>Staff Directory</a>", "text/html"),
            staff: Page(staff, staff, 200, """
                <article class='staff-card'>
                  <div>Central High School</div>
                  <h3>Jordan Smith</h3>
                  <div>Principal</div>
                  <a href='mailto:jordan@district.example'>Email</a>
                  <div>417-555-1000</div>
                </article>
            """, "text/html"),
        }
        result = SchoolScraper(MemoryHttp(pages)).scrape(school(), unresolved())
        principal = next(contact for contact in result.contacts if contact.name == "Jordan Smith")
        self.assertTrue(principal.method.startswith("district_"))
        self.assertLess(principal.score, 7.0)
        self.assertLess(principal.assignment_score, 8.0)
        self.assertIn("review", principal.assignment_reason)
        self.assertIn(staff, result.contact_pages)

    def test_generic_district_principal_is_not_borrowed(self):
        home = "https://district.example/"
        pages = {
            home: Page(home, home, 200, """
                <article class='staff-card'>
                  <h3>Alex Morgan</h3>
                  <div>Principal</div>
                  <a href='mailto:alex@district.example'>Email</a>
                </article>
            """, "text/html"),
        }
        result = SchoolScraper(MemoryHttp(pages)).scrape(school(), unresolved())
        self.assertNotIn("Alex Morgan", {contact.name for contact in result.contacts})
        self.assertIn("Jordan Smith", {contact.name for contact in result.contacts})
        self.assertTrue(all(contact.method == "official_state_record" for contact in result.contacts))

    def test_peer_school_record_is_rejected(self):
        home = "https://district.example/"
        pages = {
            home: Page(home, home, 200, """
                <article class='staff-card'>
                  <div>West High School</div>
                  <h3>Taylor Reed</h3>
                  <div>Principal</div>
                  <a href='mailto:taylor@district.example'>Email</a>
                </article>
            """, "text/html"),
        }
        result = SchoolScraper(MemoryHttp(pages)).scrape(school(), unresolved())
        self.assertNotIn("Taylor Reed", {contact.name for contact in result.contacts})

    def test_unrelated_unresolved_reason_does_not_crawl(self):
        home = "https://district.example/"
        http = MemoryHttp({
            home: Page(home, home, 200, "<h3>Jordan Smith</h3><div>Principal</div>", "text/html")
        })
        resolution = Resolution(
            status="unresolved",
            seed_url=home,
            fallback_url=home,
            reason="no_valid_school_homepage",
        )
        result = SchoolScraper(http).scrape(school(), resolution)
        self.assertEqual([contact.method for contact in result.contacts], ["official_state_record"])
        self.assertEqual(result.contact_pages, [])


if __name__ == "__main__":
    unittest.main()
