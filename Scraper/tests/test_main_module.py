# tests/test_main_module.py
import importlib
import json

main_mod = importlib.import_module("main")


def test_load_and_save_json_roundtrip(tmp_path):
    p = tmp_path / "x.json"
    data = {"a": 1}
    main_mod.save_json(str(p), data)
    assert main_mod.load_json(str(p)) == data


def test_upsert_json_value(tmp_path):
    p = tmp_path / "x.json"
    p.write_text(json.dumps({"old": 1}), encoding="utf-8")
    main_mod.upsert_json_value(str(p), "new", 2)
    after = json.loads(p.read_text(encoding="utf-8"))
    assert after["old"] == 1
    assert after["new"] == 2


def test_get_school_batch_defaults():
    schools = [{"id": i} for i in range(250)]
    batch, start, end = main_mod.get_school_batch(schools, {"global": {}})
    assert len(batch) == 100
    assert start == 0
    assert end == 100


def test_get_school_batch_wraps_when_start_exceeds_length():
    schools = [{"id": i} for i in range(10)]
    settings = {"global": {"normal_webcrawler_counter": 4, "normal_webcrawler_start_index": 20}}
    batch, start, end = main_mod.get_school_batch(schools, settings)
    assert start == 0
    assert end == 4
    assert [r["id"] for r in batch] == [0, 1, 2, 3]


def test_update_next_start_index_writes_settings(tmp_path, monkeypatch):
    target = tmp_path / "settings.json"
    monkeypatch.setattr(main_mod, "SETTINGS_FILE", str(target))
    data = {}
    main_mod.update_next_start_index(data, 33)
    saved = json.loads(target.read_text(encoding="utf-8"))
    assert saved["global"]["normal_webcrawler_start_index"] == 33


def test_run_wrappers_swallow_errors(monkeypatch):
    class BoomEvent:
        def run(self):
            raise RuntimeError("boom")

    monkeypatch.setattr(main_mod, "EventScraper", lambda: BoomEvent())
    main_mod.run_calendar_scraper()

    monkeypatch.setattr(main_mod, "get_cps_school", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    main_mod.run_cps_scraper()