import tempfile
import unittest
from pathlib import Path

from main import SchoolReach
from contact_quality import ContactTitleNormalizer
from helpers import read_json
from models import Contact, Event, Resolution, School, SchoolResult
from scraper import SchoolScraper


class FakeRoster:
    def __init__(self, schools):
        self.schools = schools

    def load(self, folder):
        return list(self.schools)


class CountingResolver:
    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail

    def resolve(self, school):
        self.calls += 1
        if self.fail:
            raise RuntimeError("fixture failure")
        return Resolution("resolved", school.website, school.website, school.website, "school_seed")


class FakeScraper:
    def __init__(self, http=None):
        self.calls = 0
        self.http = http

    def scrape(self, school, resolution):
        self.calls += 1
        contact = Contact("Alex Morgan", "Principal", "principal", email="alex@example.org", source_url=resolution.resolved_url, score=9.0)
        return SchoolResult(school, resolution, [contact])

    def authority_only(self, school, resolution, error=""):
        return SchoolResult(school, resolution, error=error)


class EmptyHttp:
    def get(self, url, **kwargs):
        raise AssertionError(f"Unexpected request: {url}")


class ClearingHttp:
    def __init__(self):
        self.clear_calls = 0

    def clear_page_cache(self):
        self.clear_calls += 1


class FakeExternalEvents:
    def load(self):
        return [Event("IACAC College Fair", "2099-10-01T18:00:00", location="Chicago")]


def schools():
    return [
        School("IL:1", "Alpha High School", "IL", website="https://alpha.example/"),
        School("MO:2", "Beta High School", "MO", website="https://beta.example/"),
    ]


class PipelineTests(unittest.TestCase):
    def test_checkpoint_resume_makes_no_second_resolver_call(self):
        with tempfile.TemporaryDirectory() as folder:
            resolver = CountingResolver()
            scraper = FakeScraper()
            pipeline = SchoolReach(FakeRoster(schools()), resolver, scraper, folder, workers=2)
            first = pipeline.run()
            self.assertEqual(len(first), 2)
            self.assertEqual(resolver.calls, 2)
            self.assertTrue((Path(folder) / "checkpoint.json").exists())

            second_resolver = CountingResolver(fail=True)
            second = SchoolReach(FakeRoster(schools()), second_resolver, FakeScraper(), folder, workers=2).run()
            self.assertEqual(len(second), 2)
            self.assertEqual(second_resolver.calls, 0)

    def test_exports_are_simple_valid_json_files(self):
        with tempfile.TemporaryDirectory() as folder:
            SchoolReach(FakeRoster(schools()), CountingResolver(), FakeScraper(), folder, workers=1).run()
            for name in ("results.json", "schools.json", "contacts.json", "events.json", "review.json"):
                value = read_json(Path(folder) / name)
                self.assertIsInstance(value, list)

    def test_skip_number_is_the_only_required_restart_input(self):
        with tempfile.TemporaryDirectory() as folder:
            resolver = CountingResolver()
            results = SchoolReach(FakeRoster(schools()), resolver, FakeScraper(), folder, workers=1, skip=1).run()
            self.assertEqual([result.school.name for result in results], ["Beta High School"])
            self.assertEqual(resolver.calls, 1)

    def test_exception_keeps_official_authority_contact(self):
        school = School(
            "IL:1",
            "Alpha High School",
            "IL",
            website="https://alpha.example/",
            administrator="Jordan Smith",
            administrator_title="Principal",
            directory_email="jordan@state.example",
            phone="217-555-1000",
            data_source="https://isbe.example/official.xls",
        )
        with tempfile.TemporaryDirectory() as folder:
            pipeline = SchoolReach(
                FakeRoster([school]),
                CountingResolver(fail=True),
                SchoolScraper(EmptyHttp()),
                folder,
                workers=1,
            )
            result = pipeline.run()[0]
            self.assertEqual(len(result.contacts), 1)
            self.assertEqual(result.contacts[0].method, "official_state_record")
            self.assertIn("fixture failure", result.error)

    def test_shared_homepage_is_quarantined_for_review(self):
        shared = "https://district.example/one-page"
        cohort = [
            School("IL:1", "Alpha High School", "IL", website=shared),
            School("IL:2", "Beta High School", "IL", website=shared),
        ]
        with tempfile.TemporaryDirectory() as folder:
            results = SchoolReach(FakeRoster(cohort), CountingResolver(), FakeScraper(), folder, workers=1).run()
            self.assertTrue(all(not result.resolution.resolved for result in results))
            self.assertTrue(all(result.resolution.reason == "shared_homepage_collision" for result in results))
            self.assertEqual(sum(len(result.contacts) for result in results), 0)

    def test_resolve_window_clears_shared_page_cache_between_batches(self):
        cohort = schools() + [School("IL:3", "Gamma High School", "IL", website="https://gamma.example/")]
        http = ClearingHttp()
        resolver = CountingResolver()
        resolver.http = http
        scraper = FakeScraper(http)
        with tempfile.TemporaryDirectory() as folder:
            SchoolReach(
                FakeRoster(cohort),
                resolver,
                scraper,
                folder,
                workers=2,
                resolve_window=2,
            ).run()
        self.assertEqual(http.clear_calls, 2)

    def test_external_events_are_added_without_a_false_school_link(self):
        with tempfile.TemporaryDirectory() as folder:
            SchoolReach(
                FakeRoster(schools()),
                CountingResolver(),
                FakeScraper(),
                folder,
                workers=1,
                external_event_sources=(FakeExternalEvents(),),
            ).run()
            events = read_json(Path(folder) / "events.json")
            iacac = read_json(Path(folder) / "iacac_events.json")
        self.assertEqual(len(iacac), 1)
        self.assertIsNone(events[-1]["school_key"])

    def test_contact_quality_gate_is_part_of_the_export_pipeline(self):
        class JunkScraper(FakeScraper):
            def scrape(self, school, resolution):
                return SchoolResult(
                    school,
                    resolution,
                    contacts=[Contact(
                        "Quick Links",
                        "Data Warehouse - Principal Dashboard",
                        "principal",
                        email="links@example.org",
                    )],
                )

        with tempfile.TemporaryDirectory() as folder:
            results = SchoolReach(
                FakeRoster([schools()[0]]),
                CountingResolver(),
                JunkScraper(),
                folder,
                workers=1,
                contact_quality=ContactTitleNormalizer(),
            ).run()
            report = read_json(Path(folder) / "contact_quality.json")
        self.assertEqual(results[0].contacts, [])
        self.assertEqual(report["rejected_contacts"], 1)


if __name__ == "__main__":
    unittest.main()
