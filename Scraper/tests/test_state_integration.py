import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audit_all_states import parent
from database import DatabaseRows
from helpers import attach_district_context
from main import SchoolReach
from models import School, SchoolResult, Resolution
from source_resolver import StateSourceResolver, RainbowSource, ColumnResolver
from tests.test_pipeline import CountingResolver, FakeScraper, FakeDatabaseWriter


class StateIntegrationTests(unittest.TestCase):
    def test_directory_seeds_survive_district_context_and_override_still_wins(self):
        school = School('VA:1', 'Example High School', 'VA',
                        alternate_seeds=('https://www.nfhsnetwork.com/schools/example',))
        attach_district_context([school])
        self.assertEqual(school.seeds, list(school.alternate_seeds))
        school.website_override = 'https://client.example/'
        self.assertEqual(school.seeds, ['https://client.example/'])

    def test_schools_without_districts_do_not_share_unrelated_seeds(self):
        one = School('CA:1', 'First Academy', 'CA', website='https://first.example/')
        two = School('CA:2', 'Second Academy', 'CA', website='https://second.example/')
        attach_district_context([one, two])
        self.assertEqual(one.seeds, ['https://first.example/'])
        self.assertEqual(two.seeds, ['https://second.example/'])

    def test_private_school_type_reaches_database_rows(self):
        school = School('CA:1', 'Example Academy', 'CA', school_type='Private high school')
        result = SchoolResult(school, Resolution('unresolved'))
        rows = DatabaseRows([result])
        districts = {rows.district_key(result): 1}
        self.assertEqual(rows.schools(districts)[0][5], 'Private high school')

    def test_state_subset_never_marks_other_database_schools_missing(self):
        roster = StateSourceResolver(states=['IA'])
        school = School('IA:1', 'Example High School', 'IA', website='https://school.example/')
        writer = FakeDatabaseWriter()
        with tempfile.TemporaryDirectory() as folder, patch.object(roster, 'load', return_value=[school]):
            pipeline = SchoolReach(roster, CountingResolver(), FakeScraper(), folder,
                                   database_writer=writer, workers=1)
            pipeline.run()
        self.assertFalse(writer.complete)

    def test_audit_failure_has_nonzero_exit_status(self):
        with tempfile.TemporaryDirectory() as folder, patch('audit_all_states.RESULTS', Path(folder) / 'audit.json'), patch('audit_all_states.run_one', return_value={'state':'IA','success':False,'error':'fixture failure'}):
            self.assertEqual(parent(1, ['IA']), 1)

    def test_illinois_ids_keep_the_production_rcdts_format(self):
        resolver = StateSourceResolver(states=['IL'])
        settings = resolver.data['states']['IL']['sources'][0]
        row = {'Region-2 County-3 District-4':'1234567', 'Type':'1', 'School':'23', 'FacilityName':'Example High'}
        source = RainbowSource('IL', settings)
        self.assertEqual(source.composite_id(row, ColumnResolver([row], settings)), '001234567010023')

    def test_iowa_header_setting_is_not_pinned_to_a_data_row(self):
        roster = StateSourceResolver(states=['IA'])
        for source in roster.data['states']['IA']['sources']:
            self.assertNotIn('header_row', source)


if __name__ == '__main__':
    unittest.main()
