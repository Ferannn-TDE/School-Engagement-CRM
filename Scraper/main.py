from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from pathlib import Path
import threading

from contact_quality import ContactTitleNormalizer
from database import DatabaseWriter
from iacac_events import IacacEventSource
from helpers import (
    DATABASE_MODE,
    OUTPUT_FOLDER,
    RESOLVE_WINDOW,
    SKIP,
    UPLOAD_DATABASE,
    USE_BROWSER,
    WORKERS,
    json_value,
    read_json,
    school_result_from_dict,
    write_json,
)
from models import Resolution
from resolver import HttpClient, SchoolResolver
from scraper import SchoolScraper
from sources import StateRoster


class SchoolReach:
    def __init__(
        self,
        roster,
        resolver,
        scraper,
        output_folder,
        workers=WORKERS,
        skip=0,
        resolve_window=RESOLVE_WINDOW,
        database_writer=None,
        database_mode=DATABASE_MODE,
        external_event_sources=(),
        contact_quality=None,
    ):
        self.roster = roster
        self.resolver = resolver
        self.scraper = scraper
        self.output = Path(output_folder)
        self.workers = workers
        self.skip = skip
        self.resolve_window = resolve_window
        self.database_writer = database_writer
        self.database_mode = database_mode
        self.external_event_sources = tuple(external_event_sources)
        self.contact_quality = contact_quality
        self.checkpoint_lock = threading.Lock()

    def release_runtime_memory(self):
        seen = set()
        for owner in (self.resolver, self.scraper):
            http = getattr(owner, "http", None)
            if http is None or id(http) in seen:
                continue
            seen.add(id(http))
            clear_page_cache = getattr(http, "clear_page_cache", None)
            if callable(clear_page_cache):
                clear_page_cache()

    def one_school(self, school):
        try:
            resolution = self.resolver.resolve(school)
        except Exception as error:
            resolution = Resolution(
                status="error",
                seed_url=school.seeds[0] if school.seeds else "",
                fallback_url=school.seeds[0] if school.seeds else "",
                reason=str(error),
            )
            return self.scraper.authority_only(
                school,
                resolution,
                f"{type(error).__name__}: {error}",
            )

        try:
            return self.scraper.scrape(school, resolution)
        except Exception as error:
            return self.scraper.authority_only(
                school,
                resolution,
                f"{type(error).__name__}: {error}",
            )

    def save_checkpoint(self, completed):
        with self.checkpoint_lock:
            write_json(self.output / "checkpoint.json", completed)

    def load_external_events(self):
        events = []
        for source in self.external_event_sources:
            try:
                loaded = source.load()
                events.extend(loaded)
                error = getattr(source, "last_error", "")
                if error:
                    print(
                        f"External event source {type(source).__name__}: {error}",
                        flush=True,
                    )
            except Exception as error:
                print(
                    f"External event source {type(source).__name__} failed: "
                    f"{type(error).__name__}: {error}",
                    flush=True,
                )
        return events

    def export_results(self, results, external_events=(), contact_quality=None):
        schools = []
        contacts = []
        events = []
        review = []

        for result in results:
            school = json_value(result.school)
            school.update({
                "status": result.resolution.status,
                "resolved_url": result.resolution.resolved_url,
                "method": result.resolution.method,
                "reason": result.resolution.reason,
                "platform": result.resolution.platform,
                "contacts": len(result.contacts),
                "events": len(result.events),
            })
            schools.append(school)

            for contact in result.contacts:
                contacts.append({
                    "school_key": result.school.facility_key,
                    "school_name": result.school.name,
                    **json_value(contact),
                })

            for event in result.events:
                events.append({
                    "school_key": result.school.facility_key,
                    "school_name": result.school.name,
                    **json_value(event),
                })

            if not result.resolution.resolved or result.error:
                review.append({
                    "school_key": result.school.facility_key,
                    "school_name": result.school.name,
                    "reason": result.resolution.reason,
                    "url": result.resolution.seed_url,
                    "error": result.error,
                    "trace": result.resolution.trace,
                })

        for event in external_events:
            events.append({
                "school_key": None,
                "school_name": None,
                **json_value(event),
            })

        write_json(self.output / "results.json", results)
        write_json(self.output / "schools.json", schools)
        write_json(self.output / "contacts.json", contacts)
        write_json(self.output / "events.json", events)
        write_json(self.output / "iacac_events.json", external_events)
        write_json(self.output / "contact_quality.json", contact_quality or {})
        write_json(self.output / "review.json", review)

    def quarantine_results(self, results):
        groups = defaultdict(list)
        for result in results:
            if result.resolution.resolved:
                groups[result.resolution.resolved_url].append(result)

        for url, matches in groups.items():
            if len(matches) < 2:
                continue

            school_keys = [result.school.facility_key for result in matches]
            for result in matches:
                result.resolution.trace.append({
                    "url": url,
                    "source": "batch_safeguard",
                    "reason": "shared_homepage_collision",
                    "school_keys": school_keys,
                })
                result.resolution.status = "unresolved"
                result.resolution.reason = "shared_homepage_collision"
                result.resolution.resolved_url = ""

                safe_result = self.scraper.authority_only(
                    result.school,
                    result.resolution,
                    result.error,
                )
                result.contacts = safe_result.contacts
                result.events = safe_result.events
                result.contact_pages = safe_result.contact_pages
                result.calendar_pages = safe_result.calendar_pages

    def run(self):
        self.output.mkdir(parents=True, exist_ok=True)
        schools = self.roster.load(self.output / "raw")
        schools = schools[self.skip:]

        checkpoint_path = self.output / "checkpoint.json"
        saved = read_json(checkpoint_path, {})
        if not isinstance(saved, dict):
            saved = {}

        selected_keys = {school.facility_key for school in schools}
        completed = {
            key: value
            for key, value in saved.items()
            if key in selected_keys and isinstance(value, dict)
        }
        pending = [school for school in schools if school.facility_key not in completed]
        total = len(schools)
        finished = len(completed)

        for start in range(0, len(pending), self.resolve_window):
            batch = pending[start : start + self.resolve_window]
            with ThreadPoolExecutor(max_workers=self.workers) as pool:
                futures = {pool.submit(self.one_school, school): school for school in batch}
                for future in as_completed(futures):
                    school = futures[future]
                    result = future.result()
                    completed[school.facility_key] = json_value(result)
                    self.save_checkpoint(completed)
                    finished += 1
                    print(f"{finished}/{total} {school.name}", flush=True)
            self.release_runtime_memory()

        results = [school_result_from_dict(completed[school.facility_key]) for school in schools]
        self.quarantine_results(results)
        contact_quality = (
            self.contact_quality.process(results)
            if self.contact_quality is not None
            else {}
        )
        external_events = self.load_external_events()

        completed = {
            result.school.facility_key: json_value(result)
            for result in results
        }
        self.save_checkpoint(completed)
        self.export_results(results, external_events, contact_quality)

        if self.database_writer is not None:
            self.database_writer.write(
                results,
                self.database_mode,
                external_events=external_events,
            )

        return results


class SchoolOutreach(SchoolReach):
    pass


def main():
    client = HttpClient()
    roster = StateRoster()
    resolver = SchoolResolver(client, use_browser=USE_BROWSER)
    scraper = SchoolScraper(client)
    iacac_events = IacacEventSource(client)
    contact_quality = ContactTitleNormalizer()

    database_writer = None
    if UPLOAD_DATABASE and os.environ.get("DATABASE_URL"):
        database_writer = DatabaseWriter(os.environ["DATABASE_URL"])

    pipeline = SchoolReach(
        roster,
        resolver,
        scraper,
        OUTPUT_FOLDER,
        workers=WORKERS,
        skip=SKIP,
        resolve_window=RESOLVE_WINDOW,
        database_writer=database_writer,
        database_mode=DATABASE_MODE,
        external_event_sources=(iacac_events,),
        contact_quality=contact_quality,
    )
    pipeline.run()


if __name__ == "__main__":
    main()
