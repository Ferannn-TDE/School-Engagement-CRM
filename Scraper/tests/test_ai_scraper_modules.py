# tests/test_ai_scraper_modules.py
import asyncio
import csv
import importlib

import pytest

mod = importlib.import_module("AIScraper")


class FakePuller:
    def __init__(self, schools):
        self._schools = schools
    def get_schools(self):
        return list(self._schools)


class FakeWriter:
    def __init__(self):
        self.calls = []
    def write(self, rows, filename):
        self.calls.append((list(rows), filename))


class FakeAIModel:
    def __init__(self, results):
        self.results = list(results)
    async def search(self, facility_name, city, website):
        item = self.results.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.mark.asyncio
async def test_scraper_run_batches_and_writes():
    schools = [
        {"FacilityName": "A", "City": "X", "Website": "https://a.edu"},
        {"FacilityName": "B", "City": "Y", "Website": "https://b.edu"},
    ]
    model = FakeAIModel([[{"Name": "n1"}], RuntimeError("boom")])
    writer = FakeWriter()
    scraper = mod.Scraper(model, writer, FakePuller(schools))
    await scraper.run("out.csv")
    assert len(writer.calls) == 1
    rows, fn = writer.calls[0]
    assert fn == "out.csv"
    assert len(rows) == 1


def test_csv_url_writer_writes_file(tmp_path):
    p = tmp_path / "urls.csv"
    writer = mod.CsvUrlWriter()
    writer.write([{"School Name": "A", "City": "X", "Homepage": "https://a.edu"}], str(p))
    rows = list(csv.DictReader(p.open("r", encoding="utf-8")))
    assert len(rows) == 1
    assert rows[0]["Homepage"] == "https://a.edu"


def test_scraper_url_helpers():
    s = mod.ScraperUrl(ai_model=None, writer=None, school_puller=None)
    assert s._preferred_website("http://a.edu", "https://a.edu") == "https://a.edu"
    assert s._normalize("St. John & Co, IL") == "saint john and co"
    key = s._facility_key("Alpha HS", "Chicago")
    assert key[0] and key[1]


def test_dedupe_url_rows(tmp_path):
    inp = tmp_path / "in.csv"
    inp.write_text(
        "School Name,City,Homepage\n"
        "A,Chicago,http://a.edu\n"
        "A,Chicago,https://a.edu\n",
        encoding="utf-8",
    )
    n = mod.dedupe_url_rows(str(inp))
    assert n == 1
    rows = list(csv.DictReader(inp.open("r", encoding="utf-8")))
    assert rows[0]["Homepage"] == "https://a.edu"