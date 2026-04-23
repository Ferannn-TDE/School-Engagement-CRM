import importlib
import json
import pathlib
import sys
import types
from types import SimpleNamespace

import pytest


def _bootstrap_optional_modules():
    """
    Make tests resilient even when optional runtime deps are missing in CI/local.
    We only stub what is needed for import-time wiring.
    """
    try:
        import dotenv  # noqa: F401
    except ModuleNotFoundError:
        dotenv_mod = types.ModuleType("dotenv")
        dotenv_mod.load_dotenv = lambda *args, **kwargs: None
        sys.modules["dotenv"] = dotenv_mod

    try:
        import supabase  # noqa: F401
    except ModuleNotFoundError:
        supabase_mod = types.ModuleType("supabase")
        supabase_mod.create_client = lambda *args, **kwargs: None
        client_mod = types.ModuleType("supabase.client")

        class ClientOptions:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        client_mod.ClientOptions = ClientOptions
        sys.modules["supabase"] = supabase_mod
        sys.modules["supabase.client"] = client_mod


_bootstrap_optional_modules()
uploader_module = importlib.import_module("SchoolContactUploader")
SupabaseCRMUpserter = uploader_module.SupabaseCRMUpserter


class FakeTableQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self._op = None
        self._payload = None
        self._conflict = None
        self._columns = None
        self._range = None

    def select(self, columns):
        self._op = "select"
        self._columns = [c.strip() for c in str(columns).split(",")]
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = "upsert"
        self._payload = [dict(r) for r in payload]
        self._conflict = on_conflict
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = [dict(r) for r in payload]
        return self

    def execute(self):
        if self._op == "select":
            rows = list(self.client.tables.get(self.table_name, []))
            if self._range is not None:
                start, end = self._range
                rows = rows[start : end + 1]
            if self._columns:
                projected = [{k: row.get(k) for k in self._columns} for row in rows]
            else:
                projected = rows
            self.client.calls.append(
                {
                    "table": self.table_name,
                    "op": "select",
                    "range": self._range,
                    "columns": self._columns,
                    "rows_returned": len(projected),
                }
            )
            return SimpleNamespace(data=projected)

        if self._op == "insert":
            target = self.client.tables.setdefault(self.table_name, [])
            for row in self._payload:
                target.append(dict(row))
            self.client.calls.append(
                {"table": self.table_name, "op": "insert", "rows": len(self._payload)}
            )
            return SimpleNamespace(data=self._payload)

        if self._op == "upsert":
            target = self.client.tables.setdefault(self.table_name, [])
            conflict_cols = []
            if isinstance(self._conflict, str):
                conflict_cols = [c.strip() for c in self._conflict.split(",") if c.strip()]
            elif isinstance(self._conflict, list):
                conflict_cols = [str(c).strip() for c in self._conflict if str(c).strip()]

            for row in self._payload:
                match_index = None
                if conflict_cols and all(row.get(c) is not None for c in conflict_cols):
                    for idx, existing in enumerate(target):
                        if all(existing.get(c) == row.get(c) for c in conflict_cols):
                            match_index = idx
                            break

                if match_index is None:
                    target.append(dict(row))
                else:
                    merged = dict(target[match_index])
                    merged.update(row)
                    target[match_index] = merged

            self.client.calls.append(
                {
                    "table": self.table_name,
                    "op": "upsert",
                    "rows": len(self._payload),
                    "on_conflict": self._conflict,
                }
            )
            return SimpleNamespace(data=self._payload)

        raise RuntimeError(f"Unsupported operation: {self._op}")


class FakeClient:
    def __init__(self, initial_tables=None):
        self.tables = initial_tables or {}
        self.calls = []

    def table(self, table_name):
        return FakeTableQuery(self, table_name)




@pytest.fixture
def upserter():
    obj = SupabaseCRMUpserter.__new__(SupabaseCRMUpserter)
    obj.batch_size = 2
    obj.client = FakeClient()

    class DummySizeContext:
        def scrape_school_size(self, school):
            return None

    obj.school_size_context = DummySizeContext()
    return obj


def test_safe_int_handles_common_values(upserter):
    assert upserter._safe_int(None) is None
    assert upserter._safe_int(4) == 4
    assert upserter._safe_int("4") == 4
    assert upserter._safe_int("4.0") == 4
    assert upserter._safe_int(" pending ") is None
    assert upserter._safe_int("abc") is None


def test_clean_text_trims_and_nulls(upserter):
    assert upserter._clean_text(None) is None
    assert upserter._clean_text("   ") is None
    assert upserter._clean_text(" Alice ") == "Alice"


def test_normalize_facility_key(upserter):
    raw = " Cook | My  School | Chicago | 60606 "
    out = upserter._normalize_facility_key(raw)
    assert out == "cook|my school|chicago|60606"


def test_build_facility_key_prefers_existing(upserter):
    row = {"FacilityKey": "X|Y|Z|1", "County": "a", "FacilityName": "b", "City": "c", "Zip": "d"}
    assert upserter._build_facility_key(row) == "X|Y|Z|1"


def test_build_facility_key_from_school_fields(upserter):
    row = {"County": "Cook", "FacilityName": "Alpha HS", "City": "Chicago", "Zip": "60601"}
    assert upserter._build_facility_key(row) == "Cook|Alpha HS|Chicago|60601"


def test_build_facility_key_fallback_to_nces(upserter):
    row = {"County": None, "FacilityName": None, "City": None, "Zip": None, "NCES_ID": "123456"}
    assert upserter._build_facility_key(row) == "nces|123456"


def test_chunks_splits_by_size(upserter):
    rows = [{"i": i} for i in range(5)]
    chunks = list(upserter._chunks(rows, 2))
    assert [len(c) for c in chunks] == [2, 2, 1]


def test_batched_insert_counts_rows(upserter):
    total = upserter._batched_insert("county", [{"county_name": "Cook"}, {"county_name": "Lake"}, {"county_name": "DuPage"}])
    assert total == 3
    assert len(upserter.client.tables["county"]) == 3


def test_batched_upsert_respects_conflict_key(upserter):
    upserter._batched_upsert("county", [{"county_name": "Cook"}], ["county_name"])
    upserter._batched_upsert("county", [{"county_name": "Cook"}], ["county_name"])
    assert len(upserter.client.tables["county"]) == 1


def test_upsert_county_from_schools_dedupes(upserter):
    schools = [
        {"County": " Cook "},
        {"County": "cook"},
        {"County": "Lake"},
        {"County": ""},
    ]
    count = upserter.upsert_county_from_schools(schools)
    assert count == 2
    values = sorted(r["county_name"] for r in upserter.client.tables["county"])
    assert values == ["Cook", "Lake"]


def test_upsert_schools_from_json_dedupes_by_normalized_facility(upserter):
    schools = [
        {
            "County": "Cook",
            "FacilityName": "North High School",
            "City": "Chicago",
            "Zip": "60601",
            "Telephone": "111",
            "Administrator": "Admin A",
            "Website": "https://a.edu",
        },
        {
            "County": " cook ",
            "FacilityName": "North  High   School",
            "City": " chicago ",
            "Zip": "60601",
            "Telephone": "222",
            "Administrator": "Admin B",
            "Website": "https://b.edu",
        },
    ]
    count = upserter.upsert_schools_from_json(schools)
    assert count == 1
    rows = upserter.client.tables["schools"]
    assert len(rows) == 1
    assert rows[0]["facility_key"] == "cook|north high school|chicago|60601"
    assert rows[0]["county_name"] == "Cook"


def test_extract_and_list_cps_contacts(upserter):
    cps = {
        "School A": {
            "name": "School A",
            "phone": "773-000-0000",
            "website": "https://school-a.edu",
            "contacts": {
                "administrator": {"name": "Jane Doe", "title": "Principal"},
                "second": {"name": "John Roe", "title": "Counselor"},
            },
        }
    }

    top2 = upserter._extract_cps_top2_contacts(cps["School A"])
    assert len(top2) == 2
    listing = upserter.list_cps_top2_contacts(cps)
    assert len(listing) == 2
    assert listing[0]["contact_rank"] == "1"
    assert listing[1]["contact_rank"] == "2"


def test_load_existing_staff_index_pages_until_empty(upserter):
    rows = [{"staff_id": i, "name": f"N{i}", "email": None, "job_name": "J", "school_worked_at": "cook|a|c|1"} for i in range(1, 6)]
    upserter.client = FakeClient(initial_tables={"staff": rows})
    out = upserter._load_existing_staff_index()
    assert len(out) == 5


def test_upsert_staff_from_completed_json_assigns_existing_ids_and_counts(upserter):
    schools = [
        {"County": "Cook", "FacilityName": "Alpha HS", "City": "Chicago", "Zip": "60601"},
        {"County": "Cook", "FacilityName": "Beta HS", "City": "Chicago", "Zip": "60602"},
    ]

    existing_rows = [
        {
            "staff_id": 7,
            "name": "Jane Doe",
            "email": "jane@alpha.edu",
            "job_name": "Principal",
            "school_worked_at": "cook|alpha hs|chicago|60601",
        }
    ]
    upserter.client = FakeClient(initial_tables={"staff": existing_rows})

    completed = {
        "Alpha HS": {
            "contacts": [
                {"name": "Jane Doe", "email": "jane@alpha.edu", "title": "Principal", "phone": "111"},
                {"name": "New Person", "email": "new@alpha.edu", "title": "Counselor", "phone": "222"},
                {"name": "New Person", "email": "new@alpha.edu", "title": "Counselor", "phone": "222"},
            ]
        },
        "Unknown HS": {
            "contacts": [{"name": "Ghost", "email": "g@x.com", "title": "Dean", "phone": "333"}]
        },
    }

    summary = upserter.upsert_staff_from_completed_json(schools, completed)
    assert summary["staff_skipped_unknown_school"] == 1
    assert summary["staff_unique_incoming"] == 2
    assert summary["staff_upserted_with_id"] == 1
    assert summary["staff_inserted_without_id"] == 1


def test_upsert_staff_from_cps_json_uses_existing_index(upserter, monkeypatch):
    cps = {
        "School A": {
            "name": "School A",
            "phone": "773-1",
            "contacts": {
                "administrator": {"name": "Jane Doe", "title": "Principal"},
                "second": {"name": "John Roe", "title": "Counselor"},
            },
        }
    }

    existing_key = upserter._staff_dedupe_key("Jane Doe", None, "Principal", "cps|school-a")
    monkeypatch.setattr(upserter, "_load_existing_staff_index", lambda: {existing_key: 9})

    summary = upserter.upsert_staff_from_cps_json(cps)
    assert summary["cps_staff_unique_incoming"] == 2
    assert summary["cps_staff_upserted_with_id"] == 1
    assert summary["cps_staff_inserted_without_id"] == 1


def test_run_from_sources_includes_expected_summary_keys(tmp_path, upserter, monkeypatch):
    schools = [
        {
            "County": "Cook",
            "FacilityName": "Alpha HS",
            "City": "Chicago",
            "Zip": "60601",
            "Telephone": "111",
            "Administrator": "A",
            "Website": "https://a.edu",
        }
    ]
    completed = {"Alpha HS": {"contacts": [{"name": "Jane Doe", "email": "jane@alpha.edu", "title": "Principal", "phone": "111"}]}}
    cps = {
        "School A": {
            "name": "School A",
            "phone": "773-1",
            "website": "https://school-a.edu",
            "contacts": {"administrator": {"name": "Admin A", "title": "Principal"}},
        }
    }

    schools_path = tmp_path / "schools.json"
    completed_path = tmp_path / "Completed.json"
    cps_path = tmp_path / "cps_schools.json"

    schools_path.write_text(json.dumps(schools), encoding="utf-8")
    completed_path.write_text(json.dumps(completed), encoding="utf-8")
    cps_path.write_text(json.dumps(cps), encoding="utf-8")

    summary, cps_top2 = upserter.run_from_sources(
        str(schools_path), str(completed_path), str(cps_path)
    )

    for key in [
        "county_upserted",
        "schools_upserted",
        "cps_schools_upserted",
        "staff_upserted_with_id",
        "staff_inserted_without_id",
        "cps_staff_upserted_with_id",
        "cps_staff_inserted_without_id",
    ]:
        assert key in summary
    assert isinstance(cps_top2, list)


def test_workflow_file_exists():
    workflow = pathlib.Path(".github/workflows/batch-scraper.yml")
    assert workflow.exists(), "Expected GitHub workflow file to exist"


@pytest.mark.xfail(strict=True, reason="Target state: workflow should run daily at 1am UTC")
def test_workflow_cron_is_daily_1am_utc():
    workflow = pathlib.Path(".github/workflows/batch-scraper.yml").read_text(encoding="utf-8")
    assert 'cron: "0 1 * * *"' in workflow



def test_workflow_runs_contact_upserter():
    workflow = pathlib.Path(".github/workflows/batch-scraper.yml").read_text(encoding="utf-8")
    assert "python SchoolContactUploader.py" in workflow


@pytest.mark.xfail(strict=True, reason="Target state: changed existing staff rows should reset verification")
def test_changed_existing_contact_resets_is_verified(upserter, monkeypatch):
    schools = [{"County": "Cook", "FacilityName": "Alpha HS", "City": "Chicago", "Zip": "60601"}]
    completed = {
        "Alpha HS": {
            "contacts": [
                {
                    "name": "Jane Doe",
                    "email": "jane@alpha.edu",
                    "title": "Principal",
                    "phone": "999-CHANGED",
                }
            ]
        }
    }

    upserter.client = FakeClient(
        initial_tables={
            "staff": [
                {
                    "staff_id": 42,
                    "name": "Jane Doe",
                    "email": "jane@alpha.edu",
                    "job_name": "Principal",
                    "school_worked_at": "cook|alpha hs|chicago|60601",
                    "phone": "111-OLD",
                    "is_verified": True,
                    "last_verified_at": "2026-04-01T00:00:00Z",
                }
            ]
        }
    )

    captured = {"upsert_rows": [], "insert_rows": []}

    def fake_upsert(table, rows, conflict_cols):
        captured["upsert_rows"].extend(rows)
        return len(rows)

    def fake_insert(table, rows):
        captured["insert_rows"].extend(rows)
        return len(rows)

    monkeypatch.setattr(upserter, "_batched_upsert", fake_upsert)
    monkeypatch.setattr(upserter, "_batched_insert", fake_insert)

    upserter.upsert_staff_from_completed_json(schools, completed)

    assert captured["upsert_rows"], "Expected existing row upsert"
    changed = captured["upsert_rows"][0]
    assert changed.get("is_verified") is False
    assert changed.get("last_verified_at") is None


@pytest.mark.xfail(strict=True, reason="Target state: school size scraper should populate class_size before school upsert")
def test_school_rows_include_class_size_when_available(upserter):
    schools = [
        {
            "County": "Cook",
            "FacilityName": "Alpha HS",
            "City": "Chicago",
            "Zip": "60601",
            "Telephone": "111",
            "Administrator": "A",
            "Website": "https://a.edu",
            "SchoolSize": 1800,
        }
    ]
    upserter.upsert_schools_from_json(schools)
    row = upserter.client.tables["schools"][0]
    assert row["class_size"] is not None

def test_upsert_schools_from_json_uses_school_size_context(upserter):
    class DummySizeContext:
        def scrape_school_size(self, school):
            return 1888

    upserter.school_size_context = DummySizeContext()

    schools = [
        {
            "County": "Cook",
            "FacilityName": "Alpha HS",
            "City": "Chicago",
            "Zip": "60601",
            "Telephone": "111",
            "Administrator": "A",
            "Website": "https://a.edu",
        }
    ]

    upserter.upsert_schools_from_json(schools)
    row = upserter.client.tables["schools"][0]
    assert row["class_size"] == 1888