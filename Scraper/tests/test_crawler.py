# tests/test_crawler.py
import importlib

crawler_mod = importlib.import_module("Crawler")


class FakeElement:
    def __init__(self, text):
        self.text = text

    def get_attribute(self, name):
        if name == "innerText":
            return self.text
        return None


class FakeSelenium:
    def __init__(self):
        self.page_source = "<html></html>"
        self.current_url = "https://start.edu"
        self._menus = []
        self._schools = []

    def find_elements(self, by, expr):
        if "schools" in expr and "//a[" not in expr:
            return self._menus
        if "menu" in expr and "//a[" not in expr:
            return []
        if "//a[" in expr:
            return self._schools
        return []

    def execute_script(self, script, elem):
        self.current_url = "https://resolved.edu"


class FakeActionChains:
    def __init__(self, selenium):
        self.selenium = selenium

    def move_to_element(self, elem):
        return self

    def click(self):
        return self

    def perform(self):
        self.selenium.current_url = "https://resolved.edu"


def test_similarity_basic():
    c = crawler_mod.NormalWebCrawler()
    assert c.similarity("Alpha", "alpha") >= 95


def test_resolve_school_returns_original_when_no_match(monkeypatch):
    c = crawler_mod.NormalWebCrawler()
    s = FakeSelenium()
    monkeypatch.setattr(crawler_mod, "ActionChains", FakeActionChains)
    out = c.resolve_school(s, "https://start.edu", "North High School", "Chicago")
    assert out == "https://start.edu"


def test_resolve_school_clicks_matching_school(monkeypatch):
    c = crawler_mod.NormalWebCrawler()
    s = FakeSelenium()
    s._schools = [FakeElement("North High School")]
    monkeypatch.setattr(crawler_mod, "ActionChains", FakeActionChains)
    out = c.resolve_school(s, "https://start.edu", "North High School", "Chicago")
    assert out == "https://resolved.edu"