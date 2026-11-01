import unittest
from unittest.mock import Mock
from sources import MissouriSource, MissouriPrivateSource


def source_with(*payloads):
    session=Mock();session.headers={}
    replies=[]
    for payload in payloads:
        response=Mock();response.json.return_value=payload;replies.append(response)
    session.get.side_effect=replies
    return MissouriSource(session=session),session


def page(*ids, more=False):
    return {'features':[{'attributes':{'OBJECTID':i}} for i in ids], 'exceededTransferLimit':more}


class MissouriPaginationTests(unittest.TestCase):
    def test_short_server_pages_do_not_truncate_the_roster(self):
        source,session=source_with({'count':3},page(1,more=True),page(2,more=True),page(3))
        self.assertEqual(len(source.arcgis_rows('https://example.org/layer','*')),3)
        self.assertEqual([c.kwargs['params']['resultOffset'] for c in session.get.call_args_list[1:]],[0,1,2])

    def test_empty_page_before_advertised_count_is_an_error(self):
        source,_=source_with({'count':2},page(1,more=True),page())
        with self.assertRaisesRegex(RuntimeError,'1 of 2'):source.arcgis_rows('https://example.org','*')

    def test_repeated_page_is_rejected(self):
        source,_=source_with({'count':2},page(1,more=True),page(1))
        with self.assertRaisesRegex(RuntimeError,'repeated'):source.arcgis_rows('https://example.org','*')

    def test_more_records_than_count_is_an_error(self):
        source,_=source_with({'count':1},page(1,2))
        with self.assertRaisesRegex(RuntimeError,'count changed'):source.arcgis_rows('https://example.org','*')

    def test_missing_record_identity_is_an_error(self):
        source,_=source_with({'count':1},{'features':[{'attributes':{'Facility':'School'}}]})
        with self.assertRaisesRegex(RuntimeError,'missing'):source.arcgis_rows('https://example.org','*')

    def test_district_codes_handle_duplicate_gis_ids_for_distinct_districts(self):
        payload = {'features':[
            {'attributes':{'ESRI_OID':125,'CTYDIST':'115925'}},
            {'attributes':{'ESRI_OID':125,'CTYDIST':'115936'}}]}
        source,session=source_with({'count':2},payload)
        self.assertEqual(len(source.arcgis_rows('https://example.org','*',order_by='CTYDIST')),2)
        self.assertEqual(session.get.call_args.kwargs['params']['orderByFields'],'CTYDIST')

    def test_count_errors_do_not_become_empty_success(self):
        for payload in ({'error':{'message':'Denied'}},{'count':0},{'count':'2'}):
            source,_=source_with(payload)
            with self.assertRaises(RuntimeError):source.arcgis_rows('https://example.org','*')


class MissouriScopeTests(unittest.TestCase):
    def row(self,number,name='Example School',grade='12'):
        return {'SchNum':str(number),'SchID':f'001090-{number}', 'Facility':name,'BGrade':'09','EGrade':grade}

    def test_official_high_school_ranges_are_kept_even_without_high_in_name(self):
        for number in (1050,1099,1200,1999):
            with self.subTest(number=number):
                schools=MissouriSource().from_rows([self.row(number)],[])
                self.assertEqual(len(schools),1)
                self.assertEqual(schools[0].facility_key,f'MO:001090-{number}')

    def test_detention_treatment_and_hospital_locations_are_excluded_by_default(self):
        for number in (1015,1030,6010,6015):
            self.assertEqual(MissouriSource().from_rows([self.row(number,name='Example High School')],[]),[])

    def test_virtual_alternative_career_and_special_programs_are_not_silently_removed(self):
        for number in (1020,1100,7010,8000):
            school,=MissouriSource().from_rows([self.row(number)],[])
            self.assertEqual(school.school_type,'Public secondary program')

    def test_strict_mode_is_explicit_and_institutional_inclusion_is_opt_in(self):
        self.assertEqual(MissouriSource(strict_high_schools=True).from_rows([self.row(1100)],[]),[])
        self.assertEqual(len(MissouriSource(include_institutional=True).from_rows([self.row(1015)],[])),1)

    def test_official_ninth_grade_center_is_not_lost_for_lacking_high_in_its_name(self):
        row=self.row(1070,name='Raymore-Peculiar Ninth Gr Cntr',grade='09')
        self.assertEqual(len(MissouriSource().from_rows([row],[])),1)

    def test_real_high_school_is_not_rejected_by_a_name_keyword(self):
        self.assertEqual(len(MissouriSource().from_rows([self.row(1050,name='Career Academy High School')],[])),1)

    def test_gis_loc_code_is_not_used_as_school_type(self):
        row=self.row(1015);row['Loc_Code']='1050'
        self.assertEqual(MissouriSource().from_rows([row],[]),[])

    def test_official_id_suffix_can_supply_missing_school_number(self):
        row=self.row(1050);del row['SchNum']
        self.assertEqual(len(MissouriSource().from_rows([row],[])),1)

    def test_conflicting_grades_or_event_like_records_are_not_schools(self):
        for row in (self.row(1050,grade='08'),{'Facility':'SAT Testing Date','EGrade':'12'}):
            self.assertEqual(MissouriSource().from_rows([row],[]),[])

    def test_mshsaa_parser_reads_all_embedded_rows_not_just_visible_rows(self):
        html='<table>'+''.join(f'<tr class="hide" data-organizationtype="1" data-membertype="member"><td><a href="../MySchool/?s={i}">School</a></td></tr>' for i in range(1,1002))+'</table>'
        self.assertEqual(len(MissouriPrivateSource.profile_ids(html)),1001)
