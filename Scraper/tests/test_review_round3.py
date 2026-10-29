import unittest
from dataclasses import replace
from itertools import permutations

from database import DatabaseRows, DatabaseWriter
from helpers import stable_text
from models import Event
from scraper import EventParser
from tests.test_staff_matching import school, result, person
from tests.throwaway_db import ThrowawayDatabaseTest


def target(key='IL:1', city='Springfield', district='District A'):
    return replace(school(key,'Central High School'),city=city,district_name=district,
                   address='100 School Rd',zipcode='62701')


def fairs():
    event=Event('College Fair','2099-11-12T15:00:00',start_local='2099-11-12T09:00:00',
                identity_start='2099-11-12T09:00:00',method='ics_feed',location='Gym A')
    return [event,replace(event,location='Gym B')]


def output(sch=None, events=None):
    record=result(sch or target())
    record.events=EventParser.deduplicate(fairs() if events is None else events)
    return record


class EventRowCollisionTests(unittest.TestCase):
    def test_venue_distinct_events_survive_deduplication_and_database_rows(self):
        expected=None
        for events in permutations(fairs()):
            rows=DatabaseRows([output(events=events)]).events()
            self.assertEqual(len(rows),2)
            self.assertEqual({r[1] for r in rows},{'Gym A','Gym B'})
            actual={r[1]:r[6] for r in rows}
            self.assertEqual(len(set(actual.values())),2)
            if expected is None:expected=actual
            self.assertEqual(actual,expected)

    def test_single_event_keeps_historical_id_and_uses_venue(self):
        event=fairs()[0]
        row,=DatabaseRows([output(events=[event])]).events()
        self.assertEqual(row[6],'schoolreach:'+stable_text('IL:1',event.title,event.identity_start[:16],length=32))
        self.assertEqual(row[1],'Gym A')

    def test_missing_venue_falls_back_to_school_address(self):
        row,=DatabaseRows([output(events=[replace(fairs()[0],location='')])]).events()
        self.assertEqual(row[1],DatabaseRows.school_location(target()))


class EventCollisionDatabaseTests(ThrowawayDatabaseTest):
    def write(self,events):
        writer=DatabaseWriter(self.url,connect=self.connect)
        writer.write([output(events=events)])
        return writer

    def snapshot(self):return self.query('SELECT event_id,external_id,location,attendance,archived FROM events ORDER BY event_id')

    def test_collision_reruns_and_subset_runs_keep_ids_and_client_data(self):
        self.write(fairs())
        self.assertEqual(self.query('SELECT count(*) FROM events'),[(2,)])
        self.run_sql('UPDATE events SET attendance=42, archived=true')
        before=self.snapshot()
        self.write(list(reversed(fairs())))
        self.write([fairs()[1]])
        self.write([fairs()[0]])
        self.assertEqual(self.snapshot(),before)

    def test_existing_non_first_venue_keeps_legacy_id_when_collision_appears(self):
        self.write([fairs()[1]])
        self.run_sql('UPDATE events SET attendance=77')
        before=self.snapshot()[0]
        self.write(fairs())
        self.assertEqual(self.query('SELECT count(*) FROM events'),[(2,)])
        self.assertIn(before,self.snapshot())
        self.write([fairs()[0]])
        self.assertEqual(self.query('SELECT count(*) FROM events'),[(2,)])

    def test_legacy_school_address_collision_is_held_without_guessing_or_overwriting(self):
        self.write([replace(fairs()[0],location='')])
        before=self.snapshot()
        writer=self.write(fairs())
        self.assertEqual(self.snapshot(),before)
        self.assertIn('ambiguous_legacy_event_venue',[x['reason'] for x in writer.integrity_review])

    def test_single_legacy_event_retains_id_when_new_venue_is_available(self):
        self.write([replace(fairs()[0],location='')])
        before=self.snapshot()
        self.write([fairs()[0]])
        self.assertEqual(self.snapshot(),before)

    def test_client_edited_suffix_venue_does_not_create_a_duplicate(self):
        self.write(fairs())
        self.run_sql("UPDATE events SET location='Client venue' WHERE external_id LIKE '%:venue:%'")
        before=self.snapshot()
        self.write([fairs()[1]])
        self.assertEqual(self.snapshot(),before)


class SameNameSchoolTests(ThrowawayDatabaseTest):
    def write(self,*schools):
        records=[]
        for sch in schools:
            record=output(sch,events=[fairs()[0]])
            record.contacts=[person('Jane Smith','Principal',sch.facility_key.replace(':','')+'@example.org')]
            records.append(record)
        writer=DatabaseWriter(self.url,connect=self.connect);writer.write(records)
        return writer

    def test_same_name_different_cities_keep_schools_staff_and_events_on_first_upload(self):
        a=target();b=replace(target('IL:2','Chicago','District B'),zipcode='60601',address='200 School Rd')
        self.write(a,b)
        for table in ('schools','staff','events'):
            self.assertEqual(self.query('SELECT count(*) FROM '+table),[(2,)])
        self.write(b,a)
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(2,)])

    def test_same_city_different_districts_are_not_rejected(self):
        self.write(target(),target('IL:2',district='District B'))
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(2,)])

    def test_name_only_with_no_location_or_district_is_not_sufficient(self):
        a=replace(target(),city='',address='',zipcode='',district_name='',district_code='')
        self.write(a,replace(a,facility_key='IL:2'))
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(2,)])

    def test_matching_city_and_district_still_block_different_id_duplicate(self):
        a=target();self.write(a)
        writer=self.write(replace(a,facility_key='IL:2'))
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(1,)])
        self.assertIn('possible_duplicate_school',[x['reason'] for x in writer.integrity_review])

    def test_all_same_name_candidates_are_checked_not_only_last_one(self):
        a=target();b=replace(target('IL:2','Chicago','District B'),address='200 School Rd',zipcode='60601')
        self.write(a,b)
        self.write(replace(a,facility_key='IL:3'))
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(2,)])
