import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from database import DatabaseRows, DatabaseWriter
from helpers import json_value, school_result_from_dict
from models import School, SchoolResult, Resolution
from sources import MissouriPrivateSource, StateRoster
from tests.throwaway_db import ThrowawayDatabaseTest


def profile(kind='Private', grades='9-12', city='St. Louis, MO 63124-1899', website=True, dese='096-520-1050'):
    fields = {'School Type':kind, 'School Name':'Example Academy', 'Grades Served':grades,
              'Membership Type':'Full Member', 'DESE Code':dese, 'County':'St. Louis', 'Phone':'314-555-1234'}
    html = '<table>' + ''.join(f'<tr><th>{k}:</th><td>{v}</td></tr>' for k,v in fields.items())
    if website:
        html += '<tr><th>School Website:</th><td><a href="https://example.org">Website</a></td></tr>'
    return html + '</table><span id="ctl00_lbl911StreetAddressLine1View">123 School Rd</span>' + f'<span id="ctl00_lbl911CityStateZipView">{city}</span>'


def listing(*entries):
    return '<table>' + ''.join(f'<tr data-membertype="{member}" data-organizationtype="{organization}"><td><a href="../MySchool/?s={key}">School</a></td></tr>' for key,member,organization in entries) + '</table>'


class MissouriPrivateTests(unittest.TestCase):
    def test_default_roster_includes_private_source(self):
        self.assertIsInstance(StateRoster().sources[-1], MissouriPrivateSource)

    def test_directory_excludes_junior_high_and_home_school_associations(self):
        html = listing(('10','member','1'),('20','member','3'),('30','affiliate','1'),('40','hsa','1'),('50','member','2'),('10','member','1'))
        self.assertEqual(MissouriPrivateSource.profile_ids(html),['10','20','30'])

    def test_directory_layout_failure_is_not_an_empty_success(self):
        with self.assertRaises(RuntimeError):
            MissouriPrivateSource.profile_ids('<html>Access denied</html>')

    def test_confirmed_private_school_has_official_id_and_website(self):
        school = MissouriPrivateSource.from_profile(profile(),'524')
        self.assertEqual(school.facility_key,'MO:096520-1050')
        self.assertEqual(school.website,'https://example.org/')
        self.assertEqual(school.school_type,'Private high school')
        self.assertEqual(school.city,'St. Louis')
        self.assertEqual(school.county,'St Louis')
        self.assertEqual(school.zipcode,'63124-1899')
        self.assertEqual(school.address,'123 School Rd')
        self.assertEqual(school.district_name,'')

    def test_public_and_charter_are_not_added_as_private(self):
        for kind in ('Public','Charter','Public (Charter School)'):
            self.assertIsNone(MissouriPrivateSource.from_profile(profile(kind=kind),'1'))

    def test_elementary_and_junior_high_are_excluded(self):
        for grades in ('K-8','6-8'):
            self.assertIsNone(MissouriPrivateSource.from_profile(profile(grades=grades),'1'))

    def test_missing_type_or_grades_fail_loudly(self):
        for html in (profile(kind=''),profile(grades=''),'<html>Login</html>'):
            with self.assertRaises(RuntimeError):
                MissouriPrivateSource.from_profile(html,'1')

    def test_non_missouri_location_is_not_silently_accepted(self):
        with self.assertRaises(RuntimeError):
            MissouriPrivateSource.from_profile(profile(city='Chicago, IL 60601'),'1')

    def test_profile_is_seed_when_school_website_is_missing(self):
        school = MissouriPrivateSource.from_profile(profile(website=False,dese=''),'524')
        self.assertEqual(school.facility_key,'MO:mshsaa-524')
        self.assertEqual(school.seeds,[MissouriPrivateSource.profile_url.format('524')])

    def test_school_type_roundtrip_and_database_mapping(self):
        school = MissouriPrivateSource.from_profile(profile(),'524')
        result = SchoolResult(school=school,resolution=Resolution(status='resolved'))
        restored = school_result_from_dict(json_value(result))
        rows = DatabaseRows([restored])
        self.assertEqual(rows.schools({rows.district_key(restored):1})[0][5],'Private high school')
        self.assertEqual(School('MO:1','Public School','MO').school_type,'Public high school')

    def test_download_checks_profiles_and_writes_only_confirmed_private_rows(self):
        session=Mock();session.headers={}
        session.get.return_value.text=listing(('1','member','1'),('2','member','1'))
        def reply(url, **kwargs):
            result=Mock();result.text=profile(kind='Private' if url.endswith('=1') else 'Public')
            return result
        worker=Mock();worker.headers={};worker.get.side_effect=reply
        context=Mock();context.__enter__=Mock(return_value=worker);context.__exit__=Mock(return_value=False)
        with tempfile.TemporaryDirectory() as folder, patch('sources.requests.Session',return_value=context):
            rows=MissouriPrivateSource(session=session).download(folder)
            self.assertEqual(len(rows),1)
            self.assertTrue((Path(folder)/'missouri_private/schools.json').exists())

    def test_failed_profile_aborts_instead_of_returning_partial_roster(self):
        session=Mock();session.headers={};session.get.return_value.text=listing(('1','member','1'))
        worker=Mock();worker.headers={};worker.get.side_effect=RuntimeError('download failed')
        context=Mock();context.__enter__=Mock(return_value=worker);context.__exit__=Mock(return_value=False)
        with tempfile.TemporaryDirectory() as folder, patch('sources.requests.Session',return_value=context):
            with self.assertRaises(RuntimeError):
                MissouriPrivateSource(session=session).download(folder)


class MissouriPrivateDatabaseTests(ThrowawayDatabaseTest):
    def test_private_type_is_inserted_and_client_type_edit_is_preserved(self):
        school=MissouriPrivateSource.from_profile(profile(),'524')
        result=SchoolResult(school,Resolution('resolved',resolved_url=school.website))
        writer=DatabaseWriter(self.url,connect=self.connect)
        writer.write([result])
        self.assertEqual(self.query('SELECT type_of_school FROM schools'),[('Private high school',)])
        self.run_sql("UPDATE schools SET type_of_school='Client classification'",as_app=True)
        writer.write([result])
        self.assertEqual(self.query('SELECT type_of_school FROM schools'),[('Client classification',)])
        self.assertEqual(self.query('SELECT count(*) FROM schools'),[(1,)])
