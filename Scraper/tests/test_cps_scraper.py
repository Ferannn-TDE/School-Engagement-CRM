# tests/test_cps_scraper.py
import importlib
import json

cps_mod = importlib.import_module("cps")


def test_get_cps_school_writes_only_high_schools(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    calls = {"i": 0}

    class R:
        def __init__(self, data):
            self._data = data
        def raise_for_status(self): pass
        def json(self): return self._data

    def fake_get(url, params=None):
        calls["i"] += 1
        if "TypeaheadSchoolSearch" in url:
            return R([
                {"IsHighSchool": True, "SchoolLongName": "HS One", "SchoolID": 1},
                {"IsHighSchool": False, "SchoolLongName": "MS Two", "SchoolID": 2},
            ])
        if "SingleSchoolProfile" in url:
            return R({
                "SchoolLongName": "HS One",
                "WebsiteURL": "https://hs1.edu",
                "Phone": "773-000",
                "AdministratorTitle": "Principal",
                "AdministratorFullName": "Jane Doe",
                "SecondContactTitle": "Counselor",
                "SecondContactFullName": "John Roe",
            })
        raise AssertionError("Unexpected URL")

    monkeypatch.setattr(cps_mod.requests, "get", fake_get)
    cps_mod.get_cps_school()

    out = json.loads((tmp_path / "cps_schools.json").read_text(encoding="utf-8"))
    assert "HS One" in out
    assert "MS Two" not in out
    assert out["HS One"]["contacts"]["administrator"]["name"] == "Jane Doe"