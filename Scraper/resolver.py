from difflib import SequenceMatcher
from heapq import heappop, heappush
import importlib.util
import json
import multiprocessing
import re
import threading
import time
from urllib import robotparser
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from helpers import (
    CONTENT_PATH_WORDS,
    GENERIC_NAME_WORDS,
    MAX_BODY_BYTES,
    MAX_DEPTH,
    MAX_PAGES,
    PER_HOST_DELAY,
    SOURCE_SCORES,
    USER_AGENT,
    canonical_url,
    clean,
    digits,
    host_of,
    normalize,
    related_sites,
    school_words,
)
from models import Candidate, Page, PageDecision, Resolution


class HttpClient:
    def __init__(self, delay=PER_HOST_DELAY):
        self.delay = delay
        self.local = threading.local()
        self.cache = {}
        self.robots = {}
        self.last_request = {}
        self.lock = threading.Lock()

    def session(self):
        if not hasattr(self.local, "session"):
            session = requests.Session()
            session.headers.update({
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/json,application/xml,text/calendar;q=0.9,*/*;q=0.5",
            })
            retry = Retry(
                total=2,
                connect=2,
                read=1,
                status=1,
                backoff_factor=0.3,
                status_forcelist=(429, 500, 502, 503, 504),
                allowed_methods=("GET", "HEAD"),
                respect_retry_after_header=True,
            )
            session.mount("http://", HTTPAdapter(max_retries=retry))
            session.mount("https://", HTTPAdapter(max_retries=retry))
            self.local.session = session
        return self.local.session

    def wait_for_host(self, url):
        host = host_of(url)
        with self.lock:
            elapsed = time.monotonic() - self.last_request.get(host, 0.0)
            pause = max(0.0, self.delay - elapsed)
        if pause:
            time.sleep(pause)
        with self.lock:
            self.last_request[host] = time.monotonic()

    def allowed(self, url):
        parsed = urlsplit(url)
        root = urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))
        with self.lock:
            known = root in self.robots
            rules = self.robots.get(root)

        if not known:
            robots_url = canonical_url("/robots.txt", root, allow_blocked=True)
            try:
                self.wait_for_host(robots_url)
                response = self.session().get(robots_url, timeout=(5, 8))
                if response.ok:
                    rules = robotparser.RobotFileParser()
                    rules.set_url(robots_url)
                    rules.parse(response.text.splitlines())
                else:
                    rules = None
            except Exception:
                rules = None
            with self.lock:
                self.robots[root] = rules

        return True if rules is None else rules.can_fetch(USER_AGENT, url)

    def get(self, url, use_cache=True, obey_robots=True, headers=None):
        url = canonical_url(url, allow_blocked=True)
        if not url:
            return Page("", "", error="unsafe")

        with self.lock:
            if use_cache and url in self.cache:
                return self.cache[url]

        if obey_robots and not self.allowed(url):
            page = Page(url, url, error="robots_disallowed")
            with self.lock:
                self.cache[url] = page
            return page

        try:
            self.wait_for_host(url)
            response = self.session().get(
                url,
                timeout=(8, 20),
                allow_redirects=True,
                stream=True,
                headers=headers,
            )
            final_url = canonical_url(response.url, allow_blocked=True) or url
            chunks = []
            size = 0
            for chunk in response.iter_content(65_536):
                if not chunk:
                    continue
                remaining = MAX_BODY_BYTES - size
                if remaining <= 0:
                    break
                piece = chunk[:remaining]
                chunks.append(piece)
                size += len(piece)
            body = b"".join(chunks)
            encoding = response.encoding or "utf-8"
            text = body.decode(encoding, errors="replace")
            page = Page(
                requested_url=url,
                url=final_url,
                status=response.status_code,
                text=text,
                content_type=clean(response.headers.get("Content-Type")),
            )
        except requests.RequestException as error:
            page = Page(url, url, error=f"{type(error).__name__}: {clean(error)}")

        with self.lock:
            self.cache[url] = page
            if page.url:
                self.cache[page.url] = page
        return page

    def clear_page_cache(self):
        with self.lock:
            self.cache.clear()


class BrowserRenderer:
    def __init__(self, timeout=35):
        self.timeout = timeout

    @property
    def available(self):
        return importlib.util.find_spec("playwright") is not None

    @staticmethod
    def browser_process(url, queue):
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(user_agent=USER_AGENT)
                response = page.goto(url, wait_until="domcontentloaded", timeout=8000)
                page.wait_for_timeout(1000)
                queue.put({
                    "url": page.url,
                    "status": response.status if response else 200,
                    "text": page.content(),
                    "content_type": "text/html; Playwright",
                })
                browser.close()
        except Exception as error:
            queue.put({"error": f"{type(error).__name__}: {clean(error)}"})

    def render(self, url):
        if not self.available:
            return Page(url, url, error="playwright_not_installed")

        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        process = context.Process(target=self.browser_process, args=(url, queue))
        process.start()
        process.join(self.timeout)

        if process.is_alive():
            process.terminate()
            process.join(5)
            return Page(url, url, error="browser_timeout")
        if queue.empty():
            return Page(url, url, error="browser_no_result")

        data = queue.get()
        if data.get("error"):
            return Page(url, url, error=data["error"])
        return Page(
            url,
            canonical_url(data["url"], allow_blocked=True),
            data["status"],
            data["text"],
            data["content_type"],
            rendered=True,
        )


class PageJudge:
    def platform(self, page):
        value = (page.url + " " + page.text[:100_000]).casefold()
        if "thrillshare" in value or "apptegy" in value or "/o/" in urlsplit(page.url).path:
            return "apptegy"
        if "finalsite" in value or "fsconstituent" in value or "fs-page" in value:
            return "finalsite"
        if "schoolwires" in value or "blackboard" in value or "/domain/" in value:
            return "schoolwires"
        if "schoolmessenger" in value or "schoolblocks" in value:
            return "schoolmessenger"
        if "edlio" in value or "edlioadmin" in value:
            return "edlio"
        if "wp-content" in value or "wp-json" in value or "wordpress" in value:
            return "wordpress"
        if host_of(page.url).endswith("sites.google.com"):
            return "google_sites"
        return "generic"

    @staticmethod
    def primary_text(soup):
        values = []
        if soup.title:
            values.append(clean(soup.title.get_text(" ", strip=True)))
        selectors = (
            "h1",
            "[property='og:site_name']",
            "[name='application-name']",
            "header img[alt]",
            ".logo img[alt]",
        )
        for selector in selectors:
            for node in soup.select(selector)[:5]:
                values.append(clean(node.get("content") or node.get("alt") or node.get_text(" ", strip=True)))
        return " | ".join(value for value in values if value)

    @staticmethod
    def name_evidence(school, primary, label, url):
        target_words = school_words(school.name)
        primary_words = school_words(primary)
        label_words = school_words(label)
        route_words = school_words(host_of(url).replace(".", " ") + " " + urlsplit(url).path.replace("/", " "))
        if not target_words:
            return 0.0, []

        score = 0.0
        reasons = []
        target_text = " ".join(target_words)
        primary_text = " ".join(primary_words)

        if target_text and target_text in primary_text:
            score += 6.0
            reasons.append("branding_displays_name")

        distinctive = [word for word in target_words if word not in GENERIC_NAME_WORDS and len(word) > 1]
        primary_set = set(primary_words)
        matches = sum(word in primary_set for word in distinctive)
        if distinctive:
            coverage = matches / len(distinctive)
            score += coverage * 5.0
            if coverage >= 0.75:
                reasons.append("distinctive_name_tokens")

        label_coverage = sum(word in set(label_words) for word in distinctive) / max(1, len(distinctive))
        if label_coverage >= 0.75:
            score += 2.0
            reasons.append("official_link_names_school")

        route_coverage = sum(word in set(route_words) for word in distinctive) / max(1, len(distinctive))
        if route_coverage >= 0.5:
            score += 1.5
            reasons.append("school_name_in_route")

        ratio = SequenceMatcher(None, target_text, primary_text[: max(len(target_text) * 2, 30)]).ratio()
        if ratio >= 0.72:
            score += 1.5
            reasons.append("school_name_similarity")

        def initials(words):
            value = ""
            for word in words:
                if word in GENERIC_NAME_WORDS:
                    continue
                value += word if len(word) <= 2 else word[0]
            return value

        short_target = [word for word in target_words if word not in GENERIC_NAME_WORDS]
        surname = short_target[-1] if short_target else ""
        same_surname = bool(surname and surname in primary_words)
        target_end = short_target.index(surname) + 1 if same_surname else 0
        primary_end = primary_words.index(surname) + 1 if same_surname else 0
        target_initials = initials(short_target[:target_end])
        primary_initials = initials(primary_words[:primary_end])
        initials_needed = len(short_target) >= 2 and any(len(word) <= 2 for word in short_target[:-1])

        if initials_needed and same_surname and target_initials == primary_initials:
            score += 3.0
            reasons.append("initials_and_surname_match")

        return score, reasons

    @staticmethod
    def school_level(value):
        value = normalize(value)
        if "elementary" in value or re.search(r"\belem\b", value):
            return "elementary"
        if "middle school" in value:
            return "middle"
        if "junior high" in value or "jr high" in value:
            return "junior_high"
        if re.search(r"\bhigh\b", value):
            return "high"
        return ""

    @staticmethod
    def content_route(url):
        parsed = urlsplit(url)
        pieces = {normalize(piece) for piece in parsed.path.split("/") if piece}
        if pieces & CONTENT_PATH_WORDS:
            return True
        path = normalize(parsed.path)
        if any(phrase in path for phrase in ("mobile app", "track meet", "water results", "wastewater", "lunch menu")):
            return True
        query = {normalize(key) for key in parse_qs(parsed.query)}
        if query & {"articleid", "newsid", "eventid", "productid"}:
            return True
        return parsed.path.casefold().endswith((".pdf", ".ics", ".ical"))

    def evaluate(self, school, page, candidate):
        authority = SOURCE_SCORES.get(candidate.source, 0.0)
        if not page.ok:
            return PageDecision(False, "unknown", 0.0, -10.0, authority, reasons=[page.error or f"http_{page.status}"])
        if not canonical_url(page.url):
            return PageDecision(False, "unknown", 0.0, -100.0, authority, reasons=["blocked_or_unsafe_destination"])

        soup = BeautifulSoup(page.text, "html.parser")
        primary = self.primary_text(soup)
        body = clean(soup.get_text(" ", strip=True))[:250_000]
        name_score, reasons = self.name_evidence(school, primary, candidate.label, page.url)
        identity = name_score

        target_level = self.school_level(school.name)
        primary_level = self.school_level(primary)
        level_conflict = bool(target_level and primary_level and target_level != primary_level)
        if level_conflict:
            reasons.append("school_level_conflict")

        school_phone = digits(school.phone)
        if len(school_phone) >= 7 and school_phone[-7:] in digits(body):
            identity += 2.3
            reasons.append("official_phone_match")
        if school.city and re.search(rf"\b{re.escape(normalize(school.city))}\b", normalize(body)):
            identity += 0.8
            reasons.append("official_city_match")
        admin_last = normalize(school.administrator).split()[-1:] if school.administrator else []
        if admin_last and admin_last[0] in normalize(body):
            identity += 0.6
            reasons.append("administrator_surname_match")
        address_number = re.match(r"\d+", clean(school.address))
        if address_number and address_number.group(0) in body:
            identity += 0.7
            reasons.append("address_number_match")

        target_primary = " ".join(school_words(school.name)) in " ".join(school_words(primary))
        body_words = " ".join(school_words(body))
        peer_hits = sum(" ".join(school_words(peer)) in body_words for peer in school.peer_names[:30])
        district_brand = "district" in normalize(primary) or "public schools" in normalize(primary)
        scope = "school" if name_score >= 5.0 else "unknown"

        route_words = candidate.label + " " + host_of(page.url).replace(".", " ") + " " + urlsplit(page.url).path.replace("/", " ")
        school_section = bool(
            urlsplit(page.url).path.strip("/")
            and target_level
            and self.school_level(route_words) == target_level
            and related_sites(candidate.parent, page.url)
            and name_score >= 1.5
        )
        if school_section:
            scope = "school"
            reasons.append("official_school_section")

        if level_conflict:
            scope = "wrong_school"
        elif (district_brand or peer_hits >= 2) and not target_primary and not school_section:
            scope = "district"
            reasons.append("district_page_not_school_identity")

        path = [piece for piece in urlsplit(page.url).path.split("/") if piece]
        semantic_route = set(normalize(primary + " " + candidate.label).split())
        content = self.content_route(page.url) or bool(
            semantic_route & {"directory", "payment", "payments", "registration", "staff", "store"}
        )

        route_score = 2.0 if not path else 0.5
        if len(path) == 2 and path[0].casefold() == "o":
            route_score = 2.5
            reasons.append("platform_organization_root")
        if content:
            route_score = -100.0
            reasons.append("content_page_cannot_be_homepage")

        corroboration = sum(
            reason in reasons
            for reason in (
                "official_phone_match",
                "official_city_match",
                "administrator_surname_match",
                "address_number_match",
                "school_name_in_route",
                "official_link_names_school",
            )
        )

        external_site = bool(host_of(candidate.parent) and not related_sites(candidate.parent, page.url))
        external_identity = target_primary or any(
            reason in reasons for reason in ("official_phone_match", "address_number_match")
        )
        if external_site and not external_identity:
            reasons.append("external_site_needs_stronger_identity")

        accepted = (
            scope == "school"
            and not content
            and not level_conflict
            and (not external_site or external_identity)
            and identity >= 7.0
            and (
                target_primary
                or "distinctive_name_tokens" in reasons
                or "initials_and_surname_match" in reasons
                or "official_school_section" in reasons
            )
            and (corroboration >= 1 or authority >= 2.5)
        )

        return PageDecision(
            accepted=accepted,
            scope=scope,
            identity_score=round(identity, 2),
            route_score=round(route_score, 2),
            authority_score=authority,
            platform=self.platform(page),
            reasons=reasons,
        )


class SchoolResolver:
    def __init__(self, http, use_browser=False):
        self.http = http
        self.use_browser = use_browser
        self.browser = BrowserRenderer()
        self.judge = PageJudge()

    @staticmethod
    def browser_worth_trying(page):
        if page.error == "robots_disallowed":
            return False
        if page.status in {401, 403, 429, 500, 502, 503, 504}:
            return True
        text = normalize(page.text[:20_000])
        return page.ok and len(text) < 120 and any(phrase in text for phrase in ("enable javascript", "loading", "please wait"))

    def get(self, url, browser_budget):
        page = self.http.get(url)
        if self.use_browser and browser_budget[0] > 0 and self.browser_worth_trying(page):
            browser_budget[0] -= 1
            rendered = self.browser.render(url)
            if rendered.ok:
                return rendered
        return page

    @staticmethod
    def name_coverage(school, text):
        important = [word for word in school_words(school.name) if word not in GENERIC_NAME_WORDS]
        available = set(school_words(text))
        return sum(word in available for word in important) / max(1, len(important))

    def links(self, school, page, depth):
        soup = BeautifulSoup(page.text, "html.parser")
        found = {}
        nodes = list(soup.find_all("a", href=True))
        nodes.extend(soup.find_all("option", value=True))
        nodes.extend(soup.select("[data-href], [data-url]"))

        for node in nodes[:2_000]:
            raw_url = node.get("href") or node.get("value") or node.get("data-href") or node.get("data-url")
            url = canonical_url(raw_url, page.url)
            if not url:
                continue
            label = clean(node.get_text(" ", strip=True) or node.get("aria-label") or node.get("title"))
            combined = normalize(label + " " + host_of(url) + " " + urlsplit(url).path)
            coverage = self.name_coverage(school, combined)
            score = coverage * 15.0
            source = "named_school_link" if coverage >= 0.65 else "navigation_link"
            authority_link = False

            target_level = PageJudge.school_level(school.name)
            linked_level = PageJudge.school_level(label + " " + urlsplit(url).path.replace("/", " "))
            if target_level and linked_level == target_level and related_sites(page.url, url):
                score += 7.0
                source = "named_school_link"

            if (
                "cps.edu/schools/profiles/school-overview/" in page.url.casefold()
                and normalize(label) in {"visit website", "school website"}
            ):
                score += 18.0
                source = "authority_website"
                authority_link = True

            if any(term in combined for term in ("our schools", "school directory", "campuses", "locations", "select a school")):
                score += 6.0
                source = "school_directory_hub"

            if PageJudge.content_route(url):
                score -= 8.0
            if not authority_link and not related_sites(page.url, url) and coverage < 0.65:
                continue
            if score < 3.0:
                continue

            candidate = Candidate(url, label, source, page.url, depth, score)
            if url not in found or candidate.score > found[url].score:
                found[url] = candidate

        for candidate in self.serialized_links(school, page, depth):
            if candidate.url not in found or candidate.score > found[candidate.url].score:
                found[candidate.url] = candidate

        return sorted(found.values(), key=lambda item: (-item.score, len(item.url)))[:40]

    def serialized_links(self, school, page, depth):
        soup = BeautifulSoup(page.text, "html.parser")
        documents = []

        for script in soup.find_all("script")[:250]:
            text = script.string or script.get_text() or ""
            if not text or len(text) > 1_500_000:
                continue

            for match in re.finditer(r'JSON\.parse\(("(?:\\.|[^"\\])*")\)', text, flags=re.S):
                try:
                    encoded = json.loads(match.group(1))
                    documents.append(json.loads(encoded))
                except (TypeError, json.JSONDecodeError):
                    pass

            try:
                documents.append(json.loads(text))
            except (TypeError, json.JSONDecodeError):
                start = text.find("{")
                end = text.rfind("}")
                if 0 <= start < end:
                    try:
                        documents.append(json.loads(text[start : end + 1]))
                    except json.JSONDecodeError:
                        pass

        candidates = {}
        stack = list(documents)
        visited = 0

        while stack and visited < 20_000:
            value = stack.pop()
            visited += 1

            if isinstance(value, dict):
                lowered = {normalize(key).replace(" ", ""): item for key, item in value.items()}
                name = clean(next((lowered[key] for key in ("name", "title", "organizationname", "schoolname") if key in lowered), ""))
                raw_url = clean(next((lowered[key] for key in ("url", "orgurl", "path", "pathprefix", "website", "href") if key in lowered), ""))

                if name and raw_url:
                    coverage = self.name_coverage(school, name)
                    if coverage >= 0.65:
                        if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:/|$)", raw_url, flags=re.I):
                            url = canonical_url("https://" + raw_url)
                        else:
                            url = canonical_url(raw_url, page.url)
                        if url:
                            source = "apptegy_organization" if "/o/" in urlsplit(url).path else "serialized_navigation"
                            candidates[url] = Candidate(url, name, source, page.url, depth, 18.0 + coverage * 5.0)
                stack.extend(value.values())

            elif isinstance(value, list):
                stack.extend(value)

        return list(candidates.values())

    def route_guesses(self, school, seed):
        parsed = urlsplit(seed)
        root = urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))
        words = [word for word in school_words(school.name) if word not in GENERIC_NAME_WORDS]
        slug = "-".join(words[:6])
        acronym = "".join(word[0] for word in school_words(school.name) if word not in {"school", "high", "senior"})
        paths = [f"/o/{slug}", f"/schools/{slug}", f"/{slug}"]
        if 2 <= len(acronym) <= 8:
            paths.insert(0, f"/o/{acronym}")

        output = []
        for path in paths:
            url = canonical_url(path, root)
            if url:
                output.append(Candidate(url, school.name, "route_guess", seed, 1, 2.0))
        return output

    def sitemap_links(self, school, seed, browser_budget):
        parsed = urlsplit(seed)
        root = urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))
        pending = [canonical_url("/sitemap.xml", root)]
        locations = []
        checked = 0

        while pending and checked < 3:
            sitemap_url = pending.pop(0)
            checked += 1
            page = self.get(sitemap_url, browser_budget)
            if not page.ok:
                continue
            try:
                document = ElementTree.fromstring(page.text)
            except ElementTree.ParseError:
                continue

            values = [clean(node.text) for node in document.iter() if node.tag.casefold().endswith("loc") and clean(node.text)]
            for value in values[:5_000]:
                url = canonical_url(value, root)
                if not url:
                    continue
                if urlsplit(url).path.casefold().endswith((".xml", ".xml.gz")) and len(pending) < 2:
                    pending.append(url)
                else:
                    locations.append(url)

        ranked = []
        for url in locations:
            coverage = self.name_coverage(school, urlsplit(url).path)
            if coverage >= 0.5 and not PageJudge.content_route(url):
                ranked.append(Candidate(url, school.name, "sitemap", seed, 1, 5.0 + coverage * 8.0))
        return sorted(ranked, key=lambda item: (-item.score, len(item.url)))[:20]

    @staticmethod
    def promoted_root(url):
        parsed = urlsplit(url)
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0].casefold() == "o":
            path = f"/o/{parts[1]}/"
        else:
            path = "/"
        return canonical_url(urlunsplit((parsed.scheme, parsed.netloc, path, "", "")))

    def cps_candidates(self, school, browser_budget):
        if "cps.edu" not in " ".join(school.seeds).casefold():
            return [], ""

        distinctive = [word for word in school_words(school.name) if word not in GENERIC_NAME_WORDS]
        terms = [school.name]
        if distinctive:
            terms.append(max(distinctive, key=len))

        rows = []
        api = ""
        for term in dict.fromkeys(terms):
            api = "https://www.cps.edu/api/schoolsearch/?term=" + quote(term)
            page = self.get(api, browser_budget)
            if not page.ok:
                continue
            try:
                value = json.loads(page.text)
            except json.JSONDecodeError:
                continue
            if isinstance(value, list) and value:
                rows = [row for row in value if isinstance(row, dict)]
                break

        if not rows:
            return [], ""

        ranked = []
        for row in rows:
            names = " ".join(clean(row.get(key)) for key in ("SchoolLongName", "SchoolShortName", "SchoolShortNameSearch"))
            score = self.name_coverage(school, names) * 10.0
            if school.city and normalize(school.city) == normalize(row.get("AddressCity")):
                score += 1.0
            school_phone = digits(school.phone)
            if len(school_phone) >= 7 and school_phone[-7:] in digits(row.get("Phone")):
                score += 2.0
            ranked.append((score, row))

        ranked.sort(key=lambda item: -item[0])
        candidates = []
        authority_url = ""

        for score, row in ranked[:3]:
            if score < 6.0:
                continue
            slug = clean(row.get("SchoolShortNameSearch") or row.get("SchoolID"))
            if not slug:
                continue
            profile = canonical_url("https://www.cps.edu/schools/profiles/school-overview/" + quote(slug.strip("/")))
            authority_url = authority_url or profile
            candidates.append(Candidate(
                profile,
                clean(row.get("SchoolLongName")) or school.name,
                "serialized_navigation",
                api,
                0,
                15.0 + score,
            ))

        return candidates, authority_url

    def search_seed(self, school, seed, source):
        browser_budget = [2]
        trace = []
        queue = []
        counter = 0
        cps, authority_url = self.cps_candidates(school, browser_budget)

        def add(candidate):
            nonlocal counter
            if not candidate.url:
                return
            counter += 1
            heappush(queue, (-candidate.score, counter, candidate))

        add(Candidate(seed, school.name, source, "official_state_directory", 0, 30.0))
        for candidate in cps:
            add(candidate)

        visited = set()
        sitemaps_added = False
        guesses_added = False
        pages = 0

        while queue and pages < MAX_PAGES:
            _, _, candidate = heappop(queue)
            if candidate.url in visited or candidate.depth > MAX_DEPTH:
                continue

            visited.add(candidate.url)
            pages += 1
            page = self.get(candidate.url, browser_budget)
            decision = self.judge.evaluate(school, page, candidate)
            trace.append({
                "url": candidate.url,
                "final_url": page.url,
                "source": candidate.source,
                "scope": decision.scope,
                "identity": decision.identity_score,
                "route": decision.route_score,
                "authority": decision.authority_score,
                "reasons": decision.reasons,
                "error": page.error,
            })

            if decision.accepted:
                return Resolution(
                    status="resolved",
                    seed_url=seed,
                    fallback_url=seed,
                    resolved_url=page.url,
                    method=candidate.source,
                    identity_score=decision.identity_score,
                    route_score=decision.route_score,
                    authority_score=decision.authority_score,
                    platform=decision.platform,
                    authority_url=authority_url,
                    trace=trace,
                )

            if not page.ok:
                continue

            if decision.identity_score >= 5.0 and decision.route_score < -50:
                root = self.promoted_root(page.url)
                if root and root != page.url:
                    add(Candidate(root, school.name, "serialized_navigation", page.url, candidate.depth + 1, 17.0))

            if candidate.depth < MAX_DEPTH:
                for found in self.links(school, page, candidate.depth + 1):
                    add(found)

            if not guesses_added and decision.scope == "district":
                guesses_added = True
                for guess in self.route_guesses(school, page.url):
                    add(guess)

            if not sitemaps_added and candidate.depth == 0:
                sitemaps_added = True
                for sitemap in self.sitemap_links(school, page.url, browser_budget):
                    add(sitemap)

        reason = "district found but no valid school route" if any(item["scope"] == "district" for item in trace) else "no_valid_school_homepage"
        return Resolution(
            status="unresolved",
            seed_url=seed,
            fallback_url=seed,
            authority_url=authority_url,
            reason=reason,
            trace=trace,
        )

    def resolve(self, school):
        seeds = school.seeds
        if not seeds:
            return Resolution(status="unresolved", reason="missing_official_seed")

        original = seeds[0]
        combined_trace = []
        best = None

        for seed in seeds[:3]:
            source = "school_seed" if school.website and seed == canonical_url(school.website) else "district_seed"
            attempt = self.search_seed(school, seed, source)
            combined_trace.extend(attempt.trace)
            if attempt.resolved:
                attempt.fallback_url = original
                attempt.trace = combined_trace
                return attempt
            if best is None:
                best = attempt

        return Resolution(
            status="unresolved",
            seed_url=original,
            fallback_url=original,
            authority_url=best.authority_url if best else "",
            reason=best.reason if best else "no_valid_school_homepage",
            trace=combined_trace,
        )
