"""Regression cases for the four PR-review findings."""
import tempfile
import unittest
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from database import DatabaseRows, DatabaseWriter
from helpers import json_value, read_json, school_result_from_dict, stable_text, write_json
from iacac_events import IacacEventSource
from models import Event, Page
from scraper import EventParser
from stabilization import CHECKPOINT_VERSION, restore_calendar_review, restore_checkpoint, score_is_weaker
from main import SchoolReach
from tests.test_stabilization import FixedDate, parse_feed
from tests.test_pipeline import FakeRoster, CountingResolver, FakeScraper, FakeDatabaseWriter, schools
from tests.test_staff_matching import school, result, person
from tests.throwaway_db import ThrowawayDatabaseTest


def iacac_event(raw_start):
    record = {'id':'fair-1', 'Fair Name':'College Fair', 'Start Date':raw_start, 'Venue':'Community Center'}
    with patch('iacac_events.date', FixedDate):
        return IacacEventSource.event(record, {}, 'https://example.org/fairs')


class EventIdentityTests(unittest.TestCase):
    def test_ics_tzid_keeps_pre_timezone_fix_external_id(self):
        _, events = parse_feed('DTSTART;TZID=America/New_York:20261112T193000')
        event, = events
        self.assertEqual(event.start, '2026-11-13T00:30:00')
        self.assertEqual(event.start_local, '2026-11-12T18:30:00')
        self.assertEqual(event.identity_start, '2026-11-12T19:30:00')
        output = result(schools()[0]); output.events = events
        row, = DatabaseRows([output]).events()
        expected = 'schoolreach:' + stable_text(output.school.facility_key, event.title, '2026-11-12T19:30', length=32)
        self.assertEqual(row[6], expected)

    def test_ics_utc_and_floating_id_inputs_remain_unchanged(self):
        for properties, expected in [('DTSTART:20261113T003000Z', '2026-11-13T00:30:00'),
                                     ('DTSTART:20261112T183000', '2026-11-12T18:30:00'),
                                     ('DTSTART;VALUE=DATE:20261113', '2026-11-13T00:00:00')]:
            with self.subTest(properties=properties):
                _, events = parse_feed(properties)
                self.assertEqual(events[0].identity_start, expected)

    def test_iacac_offset_keeps_historical_id_and_corrects_stored_time(self):
        event = iacac_event('2026-11-13T00:30:00Z')
        self.assertEqual(event.start, '2026-11-12T18:30:00')
        self.assertEqual(event.identity_start, '2026-11-13T00:30:00')
        row, = DatabaseRows([], external_events=[event]).events()
        expected = 'iacac:' + stable_text(event.source_url, event.title, '2026-11-13T00:30', length=32)
        self.assertEqual(row[6], expected)
        self.assertEqual(str(row[2]), '18:30:00')
        self.assertEqual(str(row[3]), '2026-11-12')

    def test_iacac_local_start_identity_does_not_shift(self):
        event = iacac_event('11/12/2026 6:30 PM')
        self.assertEqual(event.start, event.identity_start)

    def test_identity_survives_result_json_round_trip(self):
        _, events = parse_feed('DTSTART;TZID=America/New_York:20261112T193000')
        output = result(schools()[0]); output.events = events
        restored = school_result_from_dict(json_value(output))
        self.assertEqual(DatabaseRows([restored]).events()[0][6], DatabaseRows([output]).events()[0][6])

    def test_equivalent_feed_and_html_times_deduplicate(self):
        _, events = parse_feed('DTSTART:20261113T003000Z')
        ics = events[0]
        html = Event(ics.title, '2026-11-12T18:30:00', start_local='2026-11-12T18:30', method='html_time')
        for order in ([ics,html],[html,ics]):
            selected = EventParser.deduplicate(order)
            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0].method, 'ics_feed')
            self.assertEqual(selected[0].identity_start, ics.identity_start)

    def test_separate_local_sessions_are_not_collapsed(self):
        events = [Event('College Fair','2026-11-13T00:30:00',start_local='2026-11-12T18:30:00'),
                  Event('College Fair','2026-11-12T19:30:00',start_local='2026-11-12T19:30:00')]
        self.assertEqual(len(EventParser.deduplicate(events)), 2)


class ScoreComparisonTests(unittest.TestCase):
    def test_equal_float_and_decimal_scores_are_not_weaker(self):
        for score in (4.8, 7.96, 8.1, 8.54, 9.99):
            self.assertFalse(score_is_weaker(score, Decimal(str(score))))
            self.assertFalse(score_is_weaker(Decimal(str(score)), score))

    def test_lower_and_higher_scores_are_classified_correctly(self):
        self.assertTrue(score_is_weaker(7.95, Decimal('7.96')))
        self.assertFalse(score_is_weaker(7.97, Decimal('7.96')))

    def test_unknown_or_nonfinite_proposal_does_not_replace_known_score(self):
        for proposed in (None, float('nan'), float('inf'), 'invalid'):
            self.assertTrue(score_is_weaker(proposed, Decimal('7.96')))
        self.assertFalse(score_is_weaker(7.96, None))


class ReviewingScraper(FakeScraper):
    def __init__(self):
        super().__init__()
        self.events = EventParser()

    def scrape(self, target, resolution):
        self.events.review.append({'school':target.facility_key,'reason':'recurring_event_held','uid':'series-1'})
        return super().scrape(target, resolution)


class FailedWriter:
    def write(self, *args, **kwargs):
        raise RuntimeError('fixture upload failure')


class CalendarReviewResumeTests(unittest.TestCase):
    def test_failed_upload_resume_keeps_calendar_review_without_rescraping(self):
        target = schools()[0]
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError):
                SchoolReach(FakeRoster([target]), CountingResolver(), ReviewingScraper(), folder,
                            database_writer=FailedWriter()).run()
            checkpoint = read_json(Path(folder)/'checkpoint.json')
            self.assertEqual(checkpoint['version'], CHECKPOINT_VERSION)
            self.assertEqual(len(checkpoint['calendar_review']), 1)
            before = read_json(Path(folder)/'calendar_review.json')
            resolver = CountingResolver(); scraper = ReviewingScraper(); writer = FakeDatabaseWriter()
            SchoolReach(FakeRoster([target]),resolver,scraper,folder,database_writer=writer,resume=True).run()
            self.assertEqual(resolver.calls, 0)
            self.assertEqual(scraper.calls, 0)
            self.assertEqual(writer.calls, 1)
            self.assertEqual(read_json(Path(folder)/'calendar_review.json'), before)
            self.assertEqual(read_json(Path(folder)/'checkpoint.json'), {})

    def test_new_run_resets_old_review_records(self):
        target = schools()[0]
        with tempfile.TemporaryDirectory() as folder:
            scraper = ReviewingScraper()
            scraper.events.review.append({'school':'old','reason':'old'})
            SchoolReach(FakeRoster([target]),CountingResolver(),scraper,folder).run()
            self.assertEqual(len(read_json(Path(folder)/'calendar_review.json')), 1)
            self.assertEqual(read_json(Path(folder)/'calendar_review.json')[0]['school'], target.facility_key)

    def test_review_for_invalidated_or_incomplete_school_is_not_reused(self):
        saved = {'version':CHECKPOINT_VERSION,'calendar_review':[
            {'school':'IL:1','reason':'recurring_event_held'},
            {'school':'MO:2','reason':'recurring_event_held'}]}
        self.assertEqual(restore_calendar_review(saved,{'IL:1':{}}),[saved['calendar_review'][0]])

    def test_previous_version_checkpoint_is_rescraped(self):
        target = schools()[0]
        prior = FakeScraper().scrape(target, CountingResolver().resolve(target))
        saved = {'version':1, 'completed':{target.facility_key:json_value(prior)}}
        self.assertEqual(restore_checkpoint(saved,[target]),{})
        with tempfile.TemporaryDirectory() as folder:
            write_json(Path(folder)/'checkpoint.json',saved)
            resolver = CountingResolver()
            SchoolReach(FakeRoster([target]),resolver,ReviewingScraper(),folder,resume=True).run()
            self.assertEqual(resolver.calls,1)


class DatabaseReviewRegressionTests(ThrowawayDatabaseTest):
    def test_equal_decimal_score_allows_updated_phone(self):
        target = school('IL:1','Alpha High')
        contact = person('Jane Smith','Principal','jane@example.org','217-555-1111')
        contact.score = 7.96
        writer = DatabaseWriter(self.url,connect=self.connect)
        writer.write([result(target,contact)])
        writer.write([result(target,replace(contact,phone='217-555-2222'))])
        self.assertEqual(self.query('SELECT phone FROM staff'),[('217-555-2222',)])
        self.assertNotIn('weaker_staff_evidence',[item['reason'] for item in writer.integrity_review])

    def test_corrected_iacac_time_does_not_duplicate_or_overwrite_client_event(self):
        corrected = iacac_event('2026-11-13T00:30:00Z')
        legacy = replace(corrected,start=corrected.identity_start,identity_start='')
        writer = DatabaseWriter(self.url,connect=self.connect)
        writer.write([],external_events=[legacy])
        self.run_sql("UPDATE events SET attendance=123, fair_name='Client title'")
        before = self.query('SELECT to_jsonb(e) FROM events e')
        writer.write([],external_events=[corrected])
        self.assertEqual(self.query('SELECT to_jsonb(e) FROM events e'),before)
        self.assertEqual(self.query('SELECT count(*) FROM events'),[(1,)])

    def test_corrected_tzid_time_does_not_duplicate_school_event(self):
        _, events = parse_feed('DTSTART;TZID=America/New_York:20261112T193000')
        corrected = events[0]
        legacy = replace(corrected,start=corrected.identity_start,start_local=corrected.identity_start,identity_start='')
        target = school('IL:1','Alpha High')
        output = result(target);output.events = [legacy]
        writer = DatabaseWriter(self.url,connect=self.connect)
        writer.write([output])
        self.run_sql('UPDATE events SET attendance=45')
        before = self.query('SELECT to_jsonb(e) FROM events e')
        output.events = [corrected]
        writer.write([output])
        self.assertEqual(self.query('SELECT to_jsonb(e) FROM events e'),before)


if __name__ == '__main__': unittest.main()
