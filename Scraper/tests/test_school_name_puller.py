# tests/test_school_name_puller.py
import importlib
import json

mod = importlib.import_module("SchoolNamePuller")


def test_json_puller_list_and_fallbacks(tmp_path):
    p = tmp_path / "schools.json"
    p.write_text(
        json.dumps(
            [
                {"FacilityName": "A", "City": "X", "Website": "https://a.edu"},
                {"SchoolName": "B", "city": "Y", "school_urls": {"base_url": "https://b.edu"}},
            ]
        ),
        encoding="utf-8",
    )
    puller = mod.JsonSchoolPuller(str(p))
    rows = puller.get_schools()
    assert len(rows) == 2
    assert rows[1]["FacilityName"] == "B"
    assert rows[1]["Website"] == "https://b.edu"


def test_upsert_schools_json_insert_and_update(tmp_path):
    target = tmp_path / "schools.json"
    target.write_text(
        json.dumps([{"FacilityName": "A", "City": "X", "Website": "http://old"}]),
        encoding="utf-8",
    )

    incoming = [
        {"FacilityName": "A", "City": "X", "Website": "https://new"},
        {"FacilityName": "B", "City": "Y", "Website": "https://b"},
    ]
    inserted, updated, total = mod.upsert_schools_json(str(target), incoming)
    assert inserted == 1
    assert updated == 1
    assert total == 2

    saved = json.loads(target.read_text(encoding="utf-8"))
    by_name = {r["FacilityName"]: r for r in saved}
    assert by_name["A"]["Website"] == "https://new"