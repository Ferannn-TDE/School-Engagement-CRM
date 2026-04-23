# tests/test_calendar_scraper.py
import importlib
from types import SimpleNamespace

cal_mod = importlib.import_module("CalendarScraper")


class FakeTable:
    def __init__(self, sink):
        self.sink = sink

    def upsert(self, event, on_conflict=None):
        self.sink.append((event, on_conflict))
        return self

    def execute(self):
        return SimpleNamespace(data=True)


class FakeSupabase:
    def __init__(self):
        self.calls = []

    def table(self, name):
        assert name == cal_mod.TARGET_TABLE
        return FakeTable(self.calls)


def test_to_db_date_and_time_parsing():
    obj = cal_mod.EventScraper.__new__(cal_mod.EventScraper)
    assert obj.to_db_date("04/23/2026") == "2026-04-23"
    assert obj.to_db_date(None) is None
    assert obj.to_db_time("1:05 PM") == "13:05:00"
    assert obj.to_db_time("13:05") == "13:05:00"
    assert obj.to_db_time(None) is None


def test_parse_events_maps_fields():
    obj = cal_mod.EventScraper.__new__(cal_mod.EventScraper)
    data = {
        "records": [
            {
                "id": "k1",
                "field_2": "Fair One",
                "field_3": "Chicago",
                "field_1_raw": {
                    "date": "04/23/2026",
                    "time_formatted": "1:00 PM",
                    "to": {"time_formatted": "3:30 PM"},
                },
                "field_38": "Note",
            }
        ]
    }
    out = obj.parse_events(data)
    assert len(out) == 1
    assert out[0]["knack_record_id"] == "k1"
    assert out[0]["date"] == "2026-04-23"
    assert out[0]["start_time"] == "13:00:00"
    assert out[0]["end_time"] == "15:30:00"


def test_upsert_events_calls_conflict_key():
    obj = cal_mod.EventScraper.__new__(cal_mod.EventScraper)
    obj.supabase = FakeSupabase()
    obj.upsert_events([{"knack_record_id": "x"}])
    assert len(obj.supabase.calls) == 1
    event, conflict = obj.supabase.calls[0]
    assert event["knack_record_id"] == "x"
    assert conflict == "knack_record_id"


def test_fetch_json_knack_uses_knack_api(monkeypatch):
    obj = cal_mod.EventScraper.__new__(cal_mod.EventScraper)
    captured = {}

    def fake_get(url, headers=None, params=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["params"] = params
        class R:
            def raise_for_status(self): pass
            def json(self): return {"records": []}
        return R()

    monkeypatch.setattr(cal_mod.requests, "get", fake_get)
    data = obj.fetch_json("https://iacac.knack.com/college-fairs#json")
    assert data == {"records": []}
    assert captured["url"] == cal_mod.KNACK_RECORDS_URL
    assert captured["headers"]["X-Knack-Application-Id"] == cal_mod.KNACK_APP_ID