import importlib

from bs4 import BeautifulSoup

mod = importlib.import_module("SchoolSizeStrategies")


def _soup(html: str):
    return BeautifulSoup(html, "html.parser")


def test_build_queries_prefers_nces_then_name_city():
    scraper = mod.SchoolReportCardScraper()
    school = {"FacilityName": "Alpha HS", "City": "Chicago", "NCES_ID": "12345"}
    queries = scraper._build_queries(school)
    assert queries[0] == "12345 school report card"
    assert "Alpha HS Chicago school report card" in queries
    assert "Alpha HS school report card" in queries


def test_build_search_urls_formats_templates():
    scraper = mod.SchoolReportCardScraper()
    scraper.search_templates = ["https://x.test?q={query}"]
    urls = scraper._build_search_urls("Alpha HS Chicago")
    assert urls == ["https://x.test?q=Alpha+HS+Chicago"]


def test_extract_candidate_links_filters_and_scores():
    scraper = mod.SchoolReportCardScraper()
    html = """
    <html>
      <body>
        <a href="https://www.schoolreportcard.com/school/alpha-hs-chicago">Alpha HS Chicago profile</a>
        <a href="https://www.schoolreportcard.com/profile/other">Other</a>
        <a href="https://example.com/not-used">Off site</a>
      </body>
    </html>
    """
    links = scraper._extract_candidate_links(
        _soup(html),
        "https://www.schoolreportcard.com/search?q=alpha",
        "Alpha HS",
        "Chicago",
    )
    assert links
    assert links[0].startswith("https://www.schoolreportcard.com/")


def test_extract_school_size_from_html_text():
    scraper = mod.SchoolReportCardScraper()
    # Keep patterns simple for deterministic test behavior.
    scraper.school_size_patterns = [r"enrollment:\s*([\d,]+)"]
    soup = _soup("<div>Total enrollment: 1,234</div>")
    assert scraper._extract_school_size(soup) == 1234


def test_scrape_returns_direct_size_from_search_page(monkeypatch):
    scraper = mod.SchoolReportCardScraper()
    scraper.search_templates = ["https://www.schoolreportcard.com/?s={query}"]
    scraper.school_size_patterns = [r"enrollment:\s*([\d,]+)"]

    def fake_fetch_page(url):
        return _soup("<html><body>Enrollment: 2,001</body></html>")

    monkeypatch.setattr(scraper, "fetch_page", fake_fetch_page)
    size = scraper.scrape({"FacilityName": "Alpha HS", "City": "Chicago"})
    assert size == 2001


def test_scrape_follows_detail_link_when_search_has_no_size(monkeypatch):
    scraper = mod.SchoolReportCardScraper()
    scraper.search_templates = ["https://www.schoolreportcard.com/?s={query}"]
    scraper.school_size_patterns = [r"enrollment:\s*([\d,]+)"]

    search_html = """
    <html><body>
      <a href="https://www.schoolreportcard.com/school/alpha-hs-chicago">Alpha HS Chicago</a>
    </body></html>
    """
    detail_html = "<html><body>Enrollment: 950</body></html>"

    calls = {"n": 0}

    def fake_fetch_page(url):
        calls["n"] += 1
        if "school/" in url:
            return _soup(detail_html)
        return _soup(search_html)

    monkeypatch.setattr(scraper, "fetch_page", fake_fetch_page)
    size = scraper.scrape({"FacilityName": "Alpha HS", "City": "Chicago"})
    assert size == 950
    assert calls["n"] >= 2


def test_scrape_uses_cache(monkeypatch):
    scraper = mod.SchoolReportCardScraper()
    scraper.search_templates = ["https://www.schoolreportcard.com/?s={query}"]
    scraper.school_size_patterns = [r"enrollment:\s*([\d,]+)"]

    calls = {"n": 0}

    def fake_fetch_page(url):
        calls["n"] += 1
        return _soup("<html><body>Enrollment: 777</body></html>")

    monkeypatch.setattr(scraper, "fetch_page", fake_fetch_page)
    school = {"FacilityName": "Alpha HS", "City": "Chicago"}
    first = scraper.scrape(school)
    second = scraper.scrape(school)
    assert first == 777
    assert second == 777
    assert calls["n"] == 1


def test_context_delegates_to_report_card_scraper(monkeypatch):
    ctx = mod.SchoolSizeScraperContext()

    class Dummy:
        def scrape(self, school):
            return 123

    ctx.school_report_card_scraper = Dummy()
    assert ctx.scrape_school_size({"FacilityName": "A"}) == 123