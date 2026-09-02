import unittest

from models import Page, School
from resolver import Candidate, HttpClient, PageJudge, SchoolResolver


class MemoryHttp:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        return self.pages.get(url, Page(url, url, status=404, error="http_404"))


class StreamResponse:
    url = "https://encoding.example/"
    status_code = 200
    encoding = None
    headers = {"Content-Type": "text/html"}

    @property
    def apparent_encoding(self):
        raise AssertionError("A consumed stream must not be read a second time")

    def iter_content(self, size):
        yield b"<title>Encoding High School</title>"


class StreamSession:
    def get(self, *args, **kwargs):
        return StreamResponse()


def school(name="Central High School", seed="https://district.example/"):
    return School(
        facility_key="IL:1",
        name=name,
        state="IL",
        district_name="Example School District",
        city="Springfield",
        phone="217-555-1000",
        district_website=seed,
        peer_names=("North High School", "South High School"),
    )


class PageJudgeTests(unittest.TestCase):
    def setUp(self):
        self.judge = PageJudge()
        self.school = school()

    def test_district_root_is_discovery_not_identity(self):
        page = Page(
            "https://district.example/",
            "https://district.example/",
            200,
            "<title>Example School District</title><a>Central High School</a>"
            "<a>North High School</a><a>South High School</a>",
            "text/html",
        )
        decision = self.judge.evaluate(
            self.school,
            page,
            Candidate(page.url, self.school.name, "district_seed", "official", 0, 1),
        )
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.scope, "district")

    def test_school_branding_plus_phone_is_accepted(self):
        page = Page(
            "https://central.example/",
            "https://central.example/",
            200,
            "<title>Central High School</title><h1>Central High School</h1>"
            "<p>Springfield | 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            self.school,
            page,
            Candidate(page.url, self.school.name, "named_school_link", "official", 1, 10),
        )
        self.assertTrue(decision.accepted)
        self.assertEqual(decision.scope, "school")

    def test_content_page_never_becomes_homepage(self):
        page = Page(
            "https://district.example/o/central/dining",
            "https://district.example/o/central/dining",
            200,
            "<title>Central High School</title><h1>Central High School</h1><p>217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            self.school,
            page,
            Candidate(page.url, self.school.name, "named_school_link", "official", 1, 10),
        )
        self.assertFalse(decision.accepted)
        self.assertIn("content_page_cannot_be_homepage", decision.reasons)

    def test_initials_and_expanded_abbreviations_match(self):
        target = school("A B Shepard High Sch (Campus)", "https://chsd218.example/")
        page = Page(
            "https://shepard.chsd218.example/",
            "https://shepard.chsd218.example/",
            200,
            "<title>Alan B. Shepard High School</title><h1>Alan B. Shepard High School</h1>"
            "<p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, target.name, "named_school_link", target.district_website, 1, 10),
        )
        self.assertTrue(decision.accepted)

    def test_two_initials_in_one_state_token_match_public_name(self):
        target = school("DD Eisenhower High Sch (Campus)", "https://chsd218.example/")
        page = Page(
            "https://eisenhower.chsd218.example/",
            "https://eisenhower.chsd218.example/",
            200,
            "<title>Dwight D. Eisenhower High School</title>"
            "<h1>Dwight D. Eisenhower High School Home</h1>"
            "<p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, "Eisenhower", "named_school_link", target.district_website, 1, 10),
        )
        self.assertTrue(decision.accepted)
        self.assertIn("initials_and_surname_match", decision.reasons)

    def test_middle_school_cannot_win_for_high_school(self):
        target = school("Belton High", "https://beltonschools.example/")
        page = Page(
            "https://bms.beltonschools.example/",
            "https://bms.beltonschools.example/",
            200,
            "<title>Home - Belton Middle School</title><h1>Home</h1>"
            "<p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, "Belton Middle School", "named_school_link", target.district_website, 1, 10),
        )
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.scope, "wrong_school")
        self.assertIn("school_level_conflict", decision.reasons)

    def test_official_high_school_section_can_be_the_school_home(self):
        target = school("Cassville High", "https://cassville.example/")
        page = Page(
            "https://cassville.example/high-school-home",
            "https://cassville.example/high-school-home",
            200,
            "<title>Cassville R-IV School District - High School Home</title>"
            "<h1>High School Home</h1><p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, "High School", "named_school_link", target.district_website, 1, 10),
        )
        self.assertTrue(decision.accepted)
        self.assertIn("official_school_section", decision.reasons)

    def test_weak_external_program_page_is_not_a_homepage(self):
        target = school("New Haven High", "https://newhaven.example/")
        page = Page(
            "https://nhreads.example.net/",
            "https://nhreads.example.net/",
            200,
            "<title>New Haven Reads</title><p>Springfield reading program</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, "New Haven Reads", "named_school_link", target.district_website, 1, 10),
        )
        self.assertFalse(decision.accepted)
        self.assertIn("external_site_needs_stronger_identity", decision.reasons)

    def test_generic_page_route_is_content_not_a_homepage(self):
        page = Page(
            "https://district.example/page/renew-central",
            "https://district.example/page/renew-central",
            200,
            "<title>Central High School Renewal</title><h1>Central High School</h1>"
            "<p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            self.school,
            page,
            Candidate(page.url, self.school.name, "named_school_link", self.school.district_website, 1, 10),
        )
        self.assertFalse(decision.accepted)
        self.assertIn("content_page_cannot_be_homepage", decision.reasons)

    def test_staff_section_is_content_even_with_an_opaque_url(self):
        target = school("New Haven High", "https://newhaven.example/")
        page = Page(
            "https://newhaven.example/201234_3",
            "https://newhaven.example/201234_3",
            200,
            "<title>New Haven School District - High School Staff</title>"
            "<h1>High School Staff</h1><p>Springfield 217-555-1000</p>",
            "text/html",
        )
        decision = self.judge.evaluate(
            target,
            page,
            Candidate(page.url, "High School Staff", "named_school_link", target.district_website, 1, 10),
        )
        self.assertFalse(decision.accepted)
        self.assertIn("content_page_cannot_be_homepage", decision.reasons)

    def test_stream_without_encoding_header_is_decoded_once(self):
        client = HttpClient(delay=0)
        client.session = lambda: StreamSession()
        page = client.get("https://encoding.example/", obey_robots=False)
        self.assertTrue(page.ok)
        self.assertIn("Encoding High School", page.text)


class ResolverCohortTests(unittest.TestCase):
    def test_apptegy_organization_json_recovers_school_route(self):
        seed = "https://district.example/"
        target = "https://district.example/o/jhs"
        pages = {
            seed: Page(
                seed,
                seed,
                200,
                "<title>Example Public Schools</title>"
                '<script type="application/json">'
                '{"organizations":[{"name":"Jefferson High School","path_prefix":"/o/jhs"}]}'
                "</script>",
                "text/html",
            ),
            target: Page(
                target,
                target,
                200,
                "<title>Jefferson High School</title><h1>Jefferson High School</h1>"
                "<p>Springfield 217-555-1000</p>",
                "text/html",
            ),
            "https://district.example/sitemap.xml": Page("", "", 404, error="http_404"),
        }
        target_school = school("Jefferson High School", seed)
        result = SchoolResolver(MemoryHttp(pages)).resolve(target_school)
        self.assertTrue(result.resolved)
        self.assertEqual(result.resolved_url, target)
        self.assertEqual(result.method, "apptegy_organization")

    def test_escaped_apptegy_json_and_schemeless_host_are_decoded(self):
        seed = "https://district.example/"
        target = "https://central.district.example/o/central-high"
        pages = {
            seed: Page(
                seed,
                seed,
                200,
                "<title>Example School District</title>"
                '<script>window.state = JSON.parse("{\\"organizations\\":'
                '[{\\"name\\":\\"Central High School\\",'
                '\\"org_url\\":\\"central.district.example/o/central-high\\"}]}")</script>',
                "text/html",
            ),
            target: Page(
                target,
                target,
                200,
                "<title>Central High School</title><h1>Central High School</h1>"
                "<p>Springfield 217-555-1000</p>",
                "text/html",
            ),
        }
        result = SchoolResolver(MemoryHttp(pages)).resolve(school(seed=seed))
        self.assertTrue(result.resolved)
        self.assertEqual(result.resolved_url, target)

    def test_cps_search_retries_with_the_distinctive_name(self):
        seed = "https://www.cps.edu/"
        full_api = "https://www.cps.edu/api/schoolsearch/?term=Foreman%20High%20School"
        short_api = "https://www.cps.edu/api/schoolsearch/?term=foreman"
        profile = "https://www.cps.edu/schools/profiles/school-overview/foreman-hs"
        target = "http://www.foremancca.example/"
        target_school = school("Foreman High School", seed)
        pages = {
            full_api: Page(full_api, full_api, 200, "[]", "application/json"),
            short_api: Page(
                short_api,
                short_api,
                200,
                '[{"SchoolShortName":"FOREMAN HS",'
                '"SchoolLongName":"Edwin G. Foreman College and Career Academy",'
                '"AddressCity":"Springfield","Phone":"217-555-1000",'
                '"SchoolShortNameSearch":"foreman-hs"}]',
                "application/json",
            ),
            profile: Page(
                profile,
                profile,
                200,
                '<title>School Overview | Chicago Public Schools</title>'
                f'<a href="{target}">VISIT WEBSITE</a>',
                "text/html",
            ),
            target: Page(
                target,
                target,
                200,
                "<title>Foreman High School</title><h1>Foreman High School</h1>"
                "<p>Springfield 217-555-1000</p>",
                "text/html",
            ),
            seed: Page(seed, seed, 200, "<title>Chicago Public Schools</title>", "text/html"),
        }
        result = SchoolResolver(MemoryHttp(pages)).resolve(target_school)
        self.assertTrue(result.resolved)
        self.assertEqual(result.resolved_url, target)
        self.assertEqual(result.authority_url, profile)

    def test_sitemap_recovers_wordpress_school(self):
        seed = "https://district.example/"
        target = "https://district.example/central-high-school/"
        sitemap = "https://district.example/sitemap.xml"
        pages = {
            seed: Page(seed, seed, 200, "<title>Example School District</title>", "text/html"),
            sitemap: Page(sitemap, sitemap, 200, f"<urlset><url><loc>{target}</loc></url></urlset>", "application/xml"),
            target: Page(target, target, 200, "<title>Central High School</title><p>Springfield 217-555-1000</p><div>wp-content</div>", "text/html"),
        }
        result = SchoolResolver(MemoryHttp(pages)).resolve(school())
        self.assertTrue(result.resolved)
        self.assertEqual(result.method, "sitemap")

    def test_named_child_content_promotes_organization_root(self):
        seed = "https://district.example/"
        content = "https://district.example/o/central/page/dining"
        root = "https://district.example/o/central/"
        pages = {
            seed: Page(seed, seed, 200, f"<title>Example School District</title><a href='{content}'>Central High School</a>", "text/html"),
            content: Page(content, content, 200, "<title>Central High School Dining</title><h1>Central High School</h1><p>217-555-1000</p>", "text/html"),
            root: Page(root, root, 200, "<title>Central High School</title><h1>Central High School</h1><p>Springfield 217-555-1000</p>", "text/html"),
            "https://district.example/sitemap.xml": Page("", "", 404, error="http_404"),
        }
        result = SchoolResolver(MemoryHttp(pages)).resolve(school())
        self.assertTrue(result.resolved)
        self.assertEqual(result.resolved_url, root)
        self.assertNotEqual(result.resolved_url, content)

    def test_failed_search_keeps_exact_official_fallback(self):
        seed = "https://district.example/legacy/path"
        pages = {seed: Page(seed, seed, 200, "<title>Example School District</title>", "text/html")}
        result = SchoolResolver(MemoryHttp(pages)).resolve(school(seed=seed))
        self.assertFalse(result.resolved)
        self.assertEqual(result.fallback_url, seed)

    def test_blocked_store_seed_is_not_crawled(self):
        target = school(seed="https://sideline.bsnsports.com/central")
        http = MemoryHttp({})
        result = SchoolResolver(http).resolve(target)
        self.assertFalse(result.resolved)
        self.assertEqual(result.reason, "missing_official_seed")
        self.assertEqual(http.calls, [])


if __name__ == "__main__":
    unittest.main()
