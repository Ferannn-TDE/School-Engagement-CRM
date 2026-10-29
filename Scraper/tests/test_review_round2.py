import unittest
from dataclasses import replace
from itertools import permutations

from database import DatabaseWriter
from models import Event
from scraper import EventParser
from tests.throwaway_db import ThrowawayDatabaseTest
from tests.test_staff_matching import school, result, person


class MissingVenueTests(unittest.TestCase):
    def events(self):
        return [Event('College Fair','2026-11-12T15:00:00',start_local='2026-11-12T09:00:00',
                      identity_start='2026-11-12T09:00:00',method='ics_feed',location=''),
                Event('College Fair','2026-11-12T09:00:00',start_local='2026-11-12T09:00',
                      method='html_time',location='School Gym')]

    def test_blank_venue_merges_with_one_known_venue_in_either_order(self):
        for order in permutations(self.events()):
            merged=EventParser.deduplicate(order)
            self.assertEqual(len(merged),1)
            self.assertEqual(merged[0].method,'ics_feed')
            self.assertEqual(merged[0].identity_start,'2026-11-12T09:00:00')
            self.assertEqual(merged[0].location,'School Gym')
            self.assertEqual(order[0].location,'' if order[0].method=='ics_feed' else 'School Gym')

    def test_blank_lower_priority_source_merges_with_known_feed_venue(self):
        feed,html=self.events()
        merged=EventParser.deduplicate([replace(feed,location='School Gym'),replace(html,location='')])
        self.assertEqual(len(merged),1)
        self.assertEqual(merged[0].method,'ics_feed')
        self.assertEqual(merged[0].location,'School Gym')

    def test_different_known_venues_and_ambiguous_blank_are_retained(self):
        feed,html=self.events()
        items=[feed,html,replace(html,location='Library')]
        for order in permutations(items):
            self.assertEqual(len(EventParser.deduplicate(order)),3)

    def test_missing_venue_does_not_merge_different_sessions(self):
        feed,html=self.events()
        html=replace(html,start='2026-11-12T10:00:00',start_local='2026-11-12T10:00:00')
        self.assertEqual(len(EventParser.deduplicate([feed,html])),2)


class StaffPresenceTests(ThrowawayDatabaseTest):
    def setup_staff(self):
        target=school('IL:1','Alpha High')
        strong=person('Jane Smith','Principal','jane@example.org','217-555-1111')
        strong.score=9.5
        self.writer=DatabaseWriter(self.url,connect=self.connect)
        self.writer.write([result(target,strong)])
        self.run_sql("UPDATE staff SET last_scraped_at='2020-01-01', missed_runs=3, missing_since='2020-01-01'")
        weak=replace(strong,score=4.8,title='Administrator',phone='217-555-9999')
        return target,strong,weak

    def test_weaker_match_refreshes_presence_without_replacing_profile_or_score(self):
        target,strong,weak=self.setup_staff()
        before=self.query('SELECT name, phone, email, job_name, scraper_score, scraper_score_at, data_source, updated_at FROM staff')
        self.writer.write([result(target,weak)])
        self.assertEqual(self.query('SELECT name, phone, email, job_name, scraper_score, scraper_score_at, data_source, updated_at FROM staff'),before)
        self.assertEqual(self.query("SELECT last_scraped_at > '2020-01-02', missed_runs, missing_since FROM staff"),[(True,0,None)])
        self.assertIn('weaker_staff_evidence',[x['reason'] for x in self.writer.integrity_review])

    def test_manual_and_archived_staff_presence_is_untouched(self):
        target,strong,weak=self.setup_staff()
        for field in ('is_scraped=false','is_scraped=true, archived=true'):
            self.run_sql('UPDATE staff SET '+field)
            before=self.query('SELECT to_jsonb(s) FROM staff s')
            self.writer.write([result(target,weak)])
            self.assertEqual(self.query('SELECT to_jsonb(s) FROM staff s'),before)

    def test_conflicting_name_does_not_refresh_presence(self):
        target,strong,weak=self.setup_staff()
        before=self.query('SELECT to_jsonb(s) FROM staff s')
        self.writer.write([result(target,replace(weak,name='Different Person'))])
        self.assertEqual(self.query('SELECT to_jsonb(s) FROM staff s'),before)

    def test_inactive_staff_is_not_reactivated_by_presence_refresh(self):
        target,strong,weak=self.setup_staff()
        self.run_sql('UPDATE staff SET is_active=false')
        self.writer.write([result(target,weak)])
        self.assertEqual(self.query('SELECT is_active,missed_runs,missing_since FROM staff'),[(False,0,None)])
