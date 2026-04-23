# tests/test_scraper_strategies_module.py
import importlib

mod = importlib.import_module("ScraperStrategies")


class DummyReact:
    def __init__(self, responses):
        self.responses = responses
        self.i = 0
    def scrape(self, url, selenium):
        out = self.responses[self.i]
        self.i += 1
        return out
    def normalize_contact(self, c):
        return {"name": (c.get("name") or "").strip().lower()}


class DummyNLP:
    def __init__(self, responses):
        self.responses = responses
        self.i = 0
    def scrape(self, url, selenium):
        out = self.responses[self.i]
        self.i += 1
        return out
    def normalize_contact(self, c):
        return {"name": (c.get("name") or "").strip().lower()}


def test_build_urls_dedupes():
    ctx = mod.ScraperContext.__new__(mod.ScraperContext)
    urls = ctx.build_urls(["/staff", "/staff", "/directory"], "https://a.edu")
    assert urls == ["https://a.edu/staff", "https://a.edu/directory"]


def test_scrape_school_uses_react_first():
    ctx = mod.ScraperContext.__new__(mod.ScraperContext)
    ctx.selenium = object()
    ctx.normalReactScraper = DummyReact([[{"name": "Jane"}], []])
    ctx.nlp_Scraper = DummyNLP([[{"name": "NLP"}], [{"name": "NLP"}]])

    out = ctx.scrape_school({}, ["/a", "/b"], "https://a.edu")
    assert len(out["records"]) == 1
    assert out["records"][0]["name"] == "Jane"


def test_scrape_school_falls_back_to_nlp_when_react_empty():
    ctx = mod.ScraperContext.__new__(mod.ScraperContext)
    ctx.selenium = object()
    ctx.normalReactScraper = DummyReact([[], []])
    ctx.nlp_Scraper = DummyNLP([[{"name": "Jane"}], [{"name": "Jane"}]])

    out = ctx.scrape_school({}, ["/a", "/b"], "https://a.edu")
    assert len(out["records"]) == 1
    assert out["records"][0]["name"] == "Jane"