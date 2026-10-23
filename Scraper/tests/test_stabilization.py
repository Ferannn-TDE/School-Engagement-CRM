"""Regression tests for the focused submission stabilization patch."""
import tempfile
import unittest
from datetime import date
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from database import DatabaseRows, DatabaseWriter
from helpers import json_value, read_json, write_json
from main import SchoolReach
from models import Event, Page, Resolution
from scraper import ContactParser, EventParser
from stabilization import restore_checkpoint
from tests.test_pipeline import FakeRoster, CountingResolver, FakeScraper, schools
from tests.test_staff_matching import school, result, person
from tests.throwaway_db import ThrowawayDatabaseTest


class FixedDate(date):
    @classmethod
    def today(cls): return cls(2026, 11, 1)


def parse_feed(properties):
    text = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:fixture\nSUMMARY:College Fair\n' + properties + '\nEND:VEVENT\nEND:VCALENDAR'
    page = Page('https://example.org/events.ics', 'https://example.org/events.ics', 200, text, 'text/calendar')
    parser = EventParser()
    with patch('scraper.date', FixedDate):
        events = parser.ics(schools()[0], page, True)
    return parser, events


class CalendarStabilizationTests(unittest.TestCase):
    def test_utc_feed_reaches_database_as_correct_central_day_and_time(self):
        _, events = parse_feed('DTSTART:20261113T003000Z\nDTEND:20261113T013000Z')
        event, = events
        self.assertEqual(event.start, '2026-11-13T00:30:00')
        self.assertEqual(event.start_local, '2026-11-12T18:30:00')
        self.assertEqual(event.end_local, '2026-11-12T19:30:00')
        output = result(schools()[0]); output.events = events
        row, = DatabaseRows([output]).events()
        self.assertEqual(str(row[3]), '2026-11-12')
        self.assertEqual(str(row[2]), '18:30:00')

    def test_timezone_property_is_preserved(self):
        _, events = parse_feed('DTSTART;TZID=America/New_York:20261112T193000')
        self.assertEqual(events[0].start_local, '2026-11-12T18:30:00')

    def test_unknown_timezone_is_held(self):
        parser, events = parse_feed('DTSTART;TZID=Unknown/Timezone:20261112T193000')
        self.assertEqual(events, [])
        self.assertEqual(parser.review[0]['reason'], 'invalid_calendar_event')

    def test_all_day_event_keeps_its_date(self):
        _, events = parse_feed('DTSTART;VALUE=DATE:20261113')
        self.assertEqual(events[0].start_local, '2026-11-13T00:00:00')

    def test_recurrence_is_held_and_reported(self):
        for property in ('RRULE:FREQ=MONTHLY;COUNT=2', 'RDATE:20261213T003000Z',
                         'EXDATE:20261113T003000Z', 'RECURRENCE-ID:20261113T003000Z'):
            with self.subTest(property=property):
                parser, events = parse_feed('DTSTART:20261113T003000Z\n' + property)
                self.assertEqual(events, [])
                self.assertEqual(parser.review[0]['reason'], 'recurring_event_held')

    def test_cancelled_event_is_not_imported(self):
        parser, events = parse_feed('DTSTART:20261113T003000Z\nSTATUS:CANCELLED')
        self.assertEqual(events, [])
        self.assertEqual(parser.review[0]['reason'], 'cancelled_event_skipped')

    def test_same_day_sessions_remain_distinct(self):
        events = [Event('College Fair', '2026-11-13T09:00:00'), Event('College Fair', '2026-11-13T18:00:00')]
        self.assertEqual(len(EventParser.deduplicate(events)), 2)

    def test_iacac_utc_timestamp_is_converted(self):
        from iacac_events import IacacEventSource
        self.assertEqual(IacacEventSource.event_datetime('2026-11-13T00:30:00Z').isoformat(),
                         '2026-11-12T18:30:00')


class CheckpointStabilizationTests(unittest.TestCase):
    def saved(self, target):
        output = FakeScraper().scrape(target, Resolution('resolved', resolved_url=target.website))
        return {'version': 2, 'calendar_review': [], 'completed': {target.facility_key: json_value(output)}}

    def test_explicit_resume_reuses_compatible_interrupted_result(self):
        target = schools()[0]
        with tempfile.TemporaryDirectory() as folder:
            write_json(Path(folder) / 'checkpoint.json', self.saved(target))
            resolver = CountingResolver()
            output = SchoolReach(FakeRoster([target]), resolver, FakeScraper(), folder, resume=True).run()
            self.assertEqual(len(output), 1)
            self.assertEqual(resolver.calls, 0)
            self.assertEqual(read_json(Path(folder) / 'checkpoint.json'), {})

    def test_default_run_does_not_reuse_checkpoint(self):
        target = schools()[0]
        with tempfile.TemporaryDirectory() as folder:
            write_json(Path(folder) / 'checkpoint.json', self.saved(target))
            resolver = CountingResolver()
            SchoolReach(FakeRoster([target]), resolver, FakeScraper(), folder).run()
            self.assertEqual(resolver.calls, 1)

    def test_changed_override_invalidates_resume(self):
        target = schools()[0]
        self.assertEqual(restore_checkpoint(self.saved(target), [replace(target, website_override='https://new.example/')]), {})

    def test_changed_roster_invalidates_resume(self):
        target = schools()[0]
        self.assertEqual(restore_checkpoint(self.saved(target), [replace(target, name='New School Name')]), {})

    def test_old_and_malformed_checkpoints_are_discarded(self):
        target = schools()[0]
        for value in ({target.facility_key: {}}, {'version': 2, 'calendar_review': [], 'completed': {target.facility_key: {}}},
                      {'version': 2, 'calendar_review': [], 'completed': []}, []):
            self.assertEqual(restore_checkpoint(value, [target]), {})

    def test_failed_and_unresolved_results_are_retried(self):
        target = schools()[0]
        for error, status in (('timeout', 'resolved'), ('', 'unresolved')):
            saved = self.saved(target)
            entry = saved['completed'][target.facility_key]
            entry['error'] = error; entry['resolution']['status'] = status
            self.assertEqual(restore_checkpoint(saved, [target]), {})

    def test_failed_upload_retains_checkpoint_for_explicit_resume(self):
        class FailedWriter:
            def write(self, *args, **kwargs): raise RuntimeError('fixture upload failure')
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError):
                SchoolReach(FakeRoster([schools()[0]]), CountingResolver(), FakeScraper(), folder,
                            database_writer=FailedWriter()).run()
            self.assertEqual(read_json(Path(folder) / 'checkpoint.json')['version'], 2)


class StaffStabilizationTests(ThrowawayDatabaseTest):
    def write(self, *outputs, **kwargs):
        writer = DatabaseWriter(self.url, connect=self.connect)
        writer.write(list(outputs), 'upsert', **kwargs)
        return writer.integrity_review

    def test_same_school_shared_email_does_not_rename_existing_person(self):
        target = school('IL:1', 'Alpha High')
        self.write(result(target, person('Jane Smith', 'Principal', 'office@alpha.example')))
        review = self.write(result(target, person('John Jones', 'Counselor', 'office@alpha.example')))
        self.assertEqual(self.query('SELECT name, job_name FROM staff'), [('Jane Smith', 'Principal')])
        self.assertIn('staff_name_conflict', [item['reason'] for item in review])

    def test_shared_email_in_one_batch_holds_both_people(self):
        target = school('IL:1', 'Alpha High')
        people = [person('Jane Smith', 'Principal', 'office@alpha.example'),
                  person('John Jones', 'Counselor', 'office@alpha.example')]
        self.assertEqual(len(ContactParser.deduplicate(people)), 2)
        review = self.write(result(target, *people))
        self.assertEqual(self.query('SELECT count(*) FROM staff'), [(0,)])
        self.assertEqual(sum(item['reason']=='shared_email_in_batch' for item in review), 2)

    def test_shared_phone_does_not_replace_distinct_email(self):
        target = school('IL:1', 'Alpha High')
        self.write(result(target, person('Chris Smith', 'Principal', 'one@alpha.example', '217-555-1000')))
        review = self.write(result(target, person('Chris Smith', 'Counselor', 'two@alpha.example', '217-555-1000')))
        self.assertEqual(self.query('SELECT email FROM staff'), [('one@alpha.example',)])
        self.assertIn('staff_email_conflict', [item['reason'] for item in review])

    def test_ambiguous_name_matches_are_held(self):
        target = school('IL:1', 'Alpha High')
        self.write(result(target, person('Chris Smith', 'Principal', 'one@alpha.example'),
                          person('Chris Smith', 'Counselor', 'two@alpha.example')))
        review = self.write(result(target, person('Chris Smith', 'Social Worker')))
        self.assertEqual(self.query('SELECT count(*) FROM staff'), [(2,)])
        self.assertIn('ambiguous_staff_match', [item['reason'] for item in review])

    def test_weaker_fallback_does_not_replace_direct_phone(self):
        target = school('IL:1', 'Alpha High')
        strong = person('Jane Smith', 'Principal', 'jane@alpha.example', '217-555-1111'); strong.score = 9.5
        weak = person('Jane Smith', 'Administrator', '', '217-555-9999'); weak.score = 4.8; weak.method = 'official_state_record'
        self.write(result(target, strong)); review = self.write(result(target, weak))
        self.assertEqual(self.query('SELECT job_name, phone FROM staff'), [('Principal', '217-555-1111')])
        self.assertIn('weaker_staff_evidence', [item['reason'] for item in review])

    def test_equal_confidence_valid_refresh_still_works(self):
        target = school('IL:1', 'Alpha High')
        before = person('Jane Smith', 'Principal', 'jane@alpha.example', '217-555-1111')
        after = replace(before, phone='217-555-2222')
        self.write(result(target, before)); self.write(result(target, after))
        self.assertEqual(self.query('SELECT phone FROM staff'), [('217-555-2222',)])

    def test_partial_runs_never_increment_missing_counters(self):
        target = school('IL:1', 'Alpha High')
        self.write(result(target, person('Jane Smith', 'Principal', 'jane@alpha.example')))
        partial = result(target); partial.contact_pages = ['https://alpha.example/staff?page=1']
        for _ in range(3): self.write(partial, complete=True)
        self.assertEqual(self.query('SELECT missed_runs,missing_since FROM staff'), [(0,None)])

    def test_county_conflict_does_not_assign_wrong_district(self):
        a = school('IL:1', 'Alpha High'); a.district_name = 'Central District'; a.county = 'Cook'
        b = school('IL:2', 'Beta High'); b.district_name = 'Central District'; b.county = 'Lake'
        self.write(result(a)); review = self.write(result(b))
        self.assertEqual(self.query("SELECT district_id FROM schools WHERE facility_key='IL:2'"), [(None,)])
        self.assertIn('ambiguous_district_match', [item['reason'] for item in review])

    def test_missing_district_name_does_not_create_a_shared_placeholder(self):
        target = school('IL:1', 'Alpha High'); target.district_name = ''
        review = self.write(result(target))
        self.assertEqual(self.query('SELECT district_id FROM schools'), [(None,)])
        self.assertEqual(self.query('SELECT count(*) FROM district'), [(0,)])
        self.assertIn('missing_district_identity', [item['reason'] for item in review])


if __name__ == '__main__': unittest.main()
