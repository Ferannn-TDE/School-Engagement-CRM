import unittest
from dataclasses import replace

from main import with_overrides
from models import Page, Resolution, School
from resolver import SchoolResolver
from scraper import SchoolScraper

RIGHT = "https://central-right.example/"
WRONG = "https://district.example/"


class MemoryHttp:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        return self.pages.get(url, Page(url, url, status=404, error="http_404"))


def school(**kwargs):
    return School("IL:1", "Central High School", "IL", district_name="Example School District",
                  city="Springfield", phone="217-555-1000", district_website=WRONG, **kwargs)


HOME = Page(RIGHT, RIGHT, 200, "<title>Central High School</title><h1>Central High School</h1>"
            "<p>Springfield 217-555-1000</p>", "text/html")


class OverridesAreReadFirstTests(unittest.TestCase):
    """The client's own links (db/013) come first; the resolver doesn't guess (plan item C9)."""

    def test_the_website_override_is_the_only_seed(self):
        self.assertEqual(school(website_override=RIGHT).seeds, [RIGHT])
        self.assertEqual(school().seeds, [WRONG])

    def test_the_resolver_uses_the_override_and_never_tries_the_scraped_site(self):
        http = MemoryHttp({RIGHT: HOME})
        result = SchoolResolver(http).resolve(school(website_override=RIGHT))
        self.assertTrue(result.resolved)
        self.assertEqual(result.resolved_url, RIGHT)
        self.assertFalse([url for url in http.calls if url.startswith(WRONG)])

    def test_the_staff_page_override_is_read_first(self):
        staff = "https://central-right.example/our-people"
        http = MemoryHttp({
            RIGHT: HOME,
            staff: Page(staff, staff, 200, "<article class='staff-card'><h3>Alex Morgan</h3>"
                        "<p>Principal</p><a href='mailto:alex@example.org'>Email</a></article>", "text/html"),
        })
        resolution = Resolution("resolved", RIGHT, RIGHT, RIGHT, "client_override")
        result = SchoolScraper(http).scrape(school(staff_page_override=staff), resolution)
        self.assertEqual(result.contact_pages[0], staff)
        self.assertIn("Alex Morgan", {c.name for c in result.contacts})

    def test_the_staff_page_override_is_read_even_when_the_website_isnt_resolved(self):
        staff = "https://central-right.example/our-people"
        http = MemoryHttp({staff: Page(staff, staff, 200, "<article class='staff-card'><h3>Alex Morgan</h3>"
                                       "<p>Principal</p><a href='mailto:alex@example.org'>Email</a></article>", "text/html")})
        result = SchoolScraper(http).scrape(school(staff_page_override=staff), Resolution("unresolved"))
        self.assertIn(staff, result.contact_pages)

    def test_the_run_adds_each_schools_overrides(self):
        schools = [School("IL:1", "Alpha", "IL"), School("IL:2", "Beta", "IL")]
        out = with_overrides(schools, {"IL:2": {"website_override": RIGHT, "staff_page_override": ""}})
        self.assertEqual([s.website_override for s in out], ["", RIGHT])


if __name__ == "__main__":
    unittest.main()
