from datetime import date, timedelta
import json
import unittest

from iacac_events import IacacEventSource
from models import Page


class FakeHttp:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        for prefix, response in self.responses:
            if url.startswith(prefix):
                body = response(url) if callable(response) else response
                return Page(url, url, 200, body, "application/json")
        return Page(url, url, 404, "")


class IacacEventSourceTests(unittest.TestCase):
    def test_configured_api_is_paginated_and_normalized(self):
        event_date = date.today() + timedelta(days=30)

        def response(url):
            page = 2 if "page=2" in url else 1
            records = [{
                "id": f"record-{page}",
                "Fair Name": f"Regional College Fair {page}",
                "Start Date": event_date.strftime("%m/%d/%Y") + " 6:00 PM",
                "Venue": "Community Center",
                "Fair Type": "Illinois Regional College Fair",
            }]
            return json.dumps({"records": records, "total_pages": 2})

        http = FakeHttp([("https://example.test/events", response)])
        source = IacacEventSource(
            http,
            api_url="https://example.test/events",
            app_id="public-app",
        )
        events = source.load()

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].category, "college_planning")
        self.assertEqual(events[0].method, "iacac_knack_api")
        self.assertEqual(events[0].start[11:16], "18:00")
        self.assertEqual(len(http.calls), 2)
        self.assertEqual(
            http.calls[0][1]["headers"]["X-Knack-Application-Id"],
            "public-app",
        )

    def test_knack_configuration_and_field_labels_are_discovered(self):
        event_date = date.today() + timedelta(days=45)
        configuration = {
            "application_id": "abc123def456abc123def456",
            "scenes": [{
                "key": "scene_1",
                "views": [{
                    "key": "view_2",
                    "columns": [
                        {"field_key": "field_1", "label": "Fair Name"},
                        {"field_key": "field_2", "label": "Start Date"},
                        {"field_key": "field_3", "label": "Location"},
                    ],
                }],
            }],
        }
        landing = (
            '<script type="application/json">'
            + json.dumps(configuration)
            + "</script>"
        )
        api = json.dumps({
            "records": [{
                "id": "record-1",
                "field_1": "Northern Illinois College Fair",
                "field_2_raw": {
                    "date": event_date.strftime("%m/%d/%Y"),
                    "time": "5:30 PM",
                },
                "field_3_raw": {
                    "street": "100 College Ave",
                    "city": "Normal",
                    "state": "IL",
                    "zip": "61761",
                },
            }],
            "total_pages": 1,
        })
        http = FakeHttp([
            ("https://iacac.example/calendar", landing),
            ("https://api.knack.com/v1/pages/scene_1/views/view_2/records", api),
        ])
        source = IacacEventSource(http, calendar_url="https://iacac.example/calendar")
        events = source.load()

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].title, "Northern Illinois College Fair")
        self.assertEqual(events[0].start[11:16], "17:30")
        self.assertIn("Normal, IL", events[0].location)


if __name__ == "__main__":
    unittest.main()
