import unittest
from datetime import datetime, time, timedelta, timezone

from database import DatabaseRows
from helpers import CENTRAL_TIME, parse_datetime, stable_text
from models import Event, Resolution, School, SchoolResult
from scraper import EventParser
from models import Page


class ParseDatetimeTests(unittest.TestCase):
    def test_a_utc_evening_time_becomes_the_previous_days_central_time(self):
        # Stored today as Nov 13 00:30, which the app showed as the wrong day.
        self.assertEqual(parse_datetime("2026-11-13T00:30:00Z", zone=CENTRAL_TIME),
                         datetime(2026, 11, 12, 18, 30))
        self.assertEqual(parse_datetime("20261113T003000Z", zone=CENTRAL_TIME),
                         datetime(2026, 11, 12, 18, 30))

    def test_an_all_day_event_at_utc_05_00_is_central_midnight(self):
        self.assertEqual(parse_datetime("2026-10-03T05:00:00+00:00", zone=CENTRAL_TIME),
                         datetime(2026, 10, 3, 0, 0))

    def test_date_only_and_unzoned_values_are_left_as_they_are(self):
        self.assertEqual(parse_datetime("20261003", zone=CENTRAL_TIME), datetime(2026, 10, 3))
        self.assertEqual(parse_datetime("2026-10-03 18:00:00", zone=CENTRAL_TIME),
                         datetime(2026, 10, 3, 18, 0))

    def test_the_default_utc_form_is_unchanged(self):
        # external_id is built from this form; it must stay exactly as before.
        self.assertEqual(parse_datetime("2026-11-13T00:30:00Z"), datetime(2026, 11, 13, 0, 30))
        self.assertEqual(parse_datetime("2026-11-12T18:30:00-06:00"), datetime(2026, 11, 13, 0, 30))


class StoredEventTimeTests(unittest.TestCase):
    def school_result(self, event):
        school = School("IL:1", "Niles North High School", "IL", city="Skokie")
        return SchoolResult(school, Resolution("resolved", resolved_url="https://example.org"), [], [event])

    def test_the_stored_row_is_local_and_the_id_does_not_change(self):
        # What the parser produces for an ICS event at 6:30 PM Central on Nov 12.
        event = Event(
            "NN College Information Night",
            start="2026-11-13T00:30:00",          # UTC, as before
            start_local="2026-11-12T18:30:00",    # new
            source_url="https://example.org/cal.ics",
            method="ics_feed",
        )
        row = DatabaseRows([self.school_result(event)]).events()[0]
        self.assertEqual(row[2], time(18, 30))
        self.assertEqual(str(row[3]), "2026-11-12")
        # The id is built from the UTC start, exactly as before this change.
        expected_id = "schoolreach:" + stable_text("IL:1", event.title, event.start[:16], length=32)
        self.assertEqual(row[6], expected_id)

    def test_the_parser_fills_in_the_local_start(self):
        # The parser only keeps events from today to a year ahead, so use a date in
        # that window, and work out the expected Central time (it depends on DST).
        utc = (datetime.now(timezone.utc) + timedelta(days=30)).replace(hour=0, minute=30, second=0, microsecond=0)
        expected_local = utc.astimezone(CENTRAL_TIME).replace(tzinfo=None)
        school = School("IL:1", "Niles North High School", "IL", city="Skokie")
        page = Page("https://example.org/cal", "https://example.org/cal", 200, "", "text/html")
        event = EventParser().make(
            school, page,
            title="Niles North High School College Information Night",
            start=utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            method="ics_feed",
            inherited_school=True,
        )
        self.assertIsNotNone(event)
        self.assertEqual(event.start, utc.replace(tzinfo=None).isoformat())
        self.assertEqual(event.start_local, expected_local.isoformat())
        self.assertLess(datetime.fromisoformat(event.start_local), datetime.fromisoformat(event.start))

if __name__ == "__main__":
    unittest.main()
