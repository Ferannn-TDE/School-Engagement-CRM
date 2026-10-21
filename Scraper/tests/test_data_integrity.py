import unittest
import json
import tempfile
from pathlib import Path
from helpers import write_json
from dataclasses import replace

from database import DatabaseWriter
from data_integrity import EXPECTED_FUNCTION, function_fingerprint
from models import Contact, Event, Resolution, School, SchoolResult
from tests.throwaway_db import LOCK_SQL, ThrowawayDatabaseTest


ALPHA = School('IL:1', 'Alpha High', 'IL', district_name='Alpha District',
               district_code='1', county='Cook', phone='old-school-phone', city='Chicago')
PAT = Contact('Pat Lee', 'Counselor', 'counselor', email='pat@example.test',
              phone='old-staff-phone', score=8.0, method='staff_card')
FAIR = Event('College Fair', '2099-10-01T18:00:00', method='ics_feed')


def result(school=ALPHA, contacts=(PAT,), events=()):
    return SchoolResult(school, Resolution('resolved', resolved_url='https://school.example.test/'),
                        list(contacts), list(events), contact_pages=['https://school.example.test/staff'])


class ProtectionFingerprintTests(unittest.TestCase):
    def test_reviewed_function_ignores_formatting_but_rejects_behavior_changes(self):
        body = LOCK_SQL.split('$fn$')[1]
        self.assertEqual(function_fingerprint(body), EXPECTED_FUNCTION)
        self.assertEqual(function_fingerprint('-- formatting only\n' + body), EXPECTED_FUNCTION)
        self.assertNotEqual(function_fingerprint(body.replace('old.manual_fields', 'new.manual_fields')),
                            EXPECTED_FUNCTION)


class ClientIntegrityTests(ThrowawayDatabaseTest):
    def write(self, results=None, **kwargs):
        writer = DatabaseWriter(self.url, connect=self.connect)
        writer.write([result()] if results is None else results, **kwargs)
        return writer.integrity_review

    def snapshot(self):
        return {table: self.query(f'SELECT to_jsonb(t) FROM {table} t ORDER BY to_jsonb(t)::text')
                for table in ('state', 'county', 'district', 'schools', 'staff', 'contacts', 'events')}

    def test_missing_trigger_stops_before_inserting_any_data(self):
        self.run_sql('DROP TRIGGER protect_manual_edits ON schools')
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'Upload stopped'):
            self.write()
        self.assertEqual(self.snapshot(), before)

    def test_disabled_or_changed_trigger_stops_upload(self):
        self.run_sql('ALTER TABLE staff DISABLE TRIGGER protect_manual_edits')
        with self.assertRaisesRegex(RuntimeError, 'Upload stopped'):
            self.write()
        self.run_sql('ALTER TABLE staff ENABLE TRIGGER protect_manual_edits')
        self.run_sql("CREATE OR REPLACE FUNCTION protect_manual_edits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$")
        with self.assertRaisesRegex(RuntimeError, 'Upload stopped'):
            self.write()
        self.assertEqual(self.query('SELECT count(*) FROM schools'), [(0,)])

    def test_signed_in_connection_is_refused(self):
        def signed_in(url):
            conn = self.connect(url)
            conn.execute("SELECT set_config('request.jwt.claims', '{\"sub\":\"client\"}', true)")
            return conn
        with self.assertRaisesRegex(RuntimeError, 'no app JWT'):
            DatabaseWriter(self.url, connect=signed_in).write([result()])
        self.assertEqual(self.query('SELECT count(*) FROM schools'), [(0,)])

    def test_locked_values_survive_while_unlocked_values_refresh(self):
        self.write()
        self.run_sql("UPDATE schools SET phone = 'client-school-phone'", as_app=True)
        self.run_sql("UPDATE staff SET job_name = 'Client Title'", as_app=True)
        self.write([result(replace(ALPHA, phone='website-school-phone', address='New address'),
                           (replace(PAT, title='Website Title', phone='new-staff-phone'),))])
        self.assertEqual(self.query("SELECT phone, address, pending_scraped->'phone'->>'value' FROM schools"),
                         [('client-school-phone', 'New address', 'website-school-phone')])
        self.assertEqual(self.query("SELECT job_name, phone, pending_scraped->'job_name'->>'value' FROM staff"),
                         [('Client Title', 'new-staff-phone', 'Website Title')])

    def test_district_assignment_and_existing_district_values_are_preserved(self):
        self.write()
        self.run_sql("UPDATE district SET county_name = NULL")
        original_id = self.query('SELECT district_id FROM schools')[0][0]
        self.write([result(replace(ALPHA, district_name='Another District', district_code='2'))])
        self.assertEqual(self.query('SELECT district_id FROM schools'), [(original_id,)])
        self.assertEqual(self.query('SELECT count(*) FROM district'), [(1,)])
        self.assertEqual(self.query('SELECT county_name FROM district WHERE district_id = %s', (original_id,)), [(None,)])
        review = self.write()
        self.assertTrue(any(r['reason'] == 'existing_district_preserved' for r in review))

    def test_shared_email_does_not_move_staff_or_add_a_second_relationship(self):
        self.write()
        beta = replace(ALPHA, facility_key='IL:2', name='Beta High')
        review = self.write([result(beta, (replace(PAT, name='Someone Else', title='Principal'),))])
        self.assertEqual(self.query('SELECT name, school_worked_at, job_name FROM staff'),
                         [('Pat Lee', 'IL:1', 'Counselor')])
        self.assertEqual(self.query('SELECT school_id FROM contacts'), [('IL:1',)])
        self.assertTrue(any(r['reason'] == 'cross_school_match_preserved' for r in review))

    def test_reference_rows_and_new_contact_links_are_inserted_once(self):
        self.write()
        self.write()
        self.assertEqual(self.query('SELECT state_code, state_name FROM state'), [('IL', 'Illinois')])
        self.assertEqual(self.query('SELECT county_name, state_code FROM county'), [('Cook', 'IL')])
        self.assertEqual(self.query('SELECT count(*) FROM contacts'), [(1,)])
        self.run_sql('UPDATE contacts SET archived = true')
        self.write()
        self.assertEqual(self.query('SELECT archived FROM contacts'), [(True,)])

    def test_event_client_changes_are_preserved_and_proposals_are_reported(self):
        self.write([result(events=(FAIR,))])
        self.run_sql("UPDATE events SET location = 'Client venue', fair_name = 'Client title', attendance = 80")
        before = self.query('SELECT to_jsonb(e) FROM events e')
        review = self.write([result(events=(FAIR,))])
        self.assertEqual(self.query('SELECT to_jsonb(e) FROM events e'), before)
        self.assertTrue(any(r['reason'] == 'existing_event_preserved' for r in review))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'database_integrity_review.json'
            write_json(path, review)
            saved = json.loads(path.read_text())
            self.assertEqual(saved[0]['proposed'][2], '18:00:00')

    def test_client_owned_school_and_children_are_not_touched(self):
        self.write([result(events=(FAIR,))])
        self.run_sql('UPDATE schools SET is_scraped = false')
        before = self.snapshot()
        self.write([result(replace(ALPHA, phone='new'), (replace(PAT, phone='new'),), (FAIR,))], complete=True)
        self.assertEqual(self.snapshot(), before)

    def test_different_id_same_state_and_name_is_held_for_review(self):
        self.write()
        review = self.write([result(replace(ALPHA, facility_key='IL:999'))])
        self.assertEqual(self.query('SELECT count(*) FROM schools'), [(1,)])
        self.assertEqual(review[0]['reason'], 'possible_duplicate_school')

    def test_failure_rolls_back_reference_rows_and_all_school_data(self):
        self.run_sql("CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$")
        self.run_sql('CREATE TRIGGER reject_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_event()')
        before = self.snapshot()
        with self.assertRaisesRegex(Exception, "synthetic failure"):
            self.write([result(events=(FAIR,))])
        self.assertEqual(self.snapshot(), before)

    def test_complete_run_does_not_mark_other_states_missing(self):
        other = replace(ALPHA, facility_key='MO:1', name='Missouri High', state='MO', county='Jackson')
        self.write([result(), result(other, ())])
        self.write([result()], complete=True)
        self.assertEqual(self.query("SELECT missed_runs, missing_since FROM schools WHERE state_code = 'MO'"), [(0, None)])


if __name__ == '__main__':
    unittest.main()
