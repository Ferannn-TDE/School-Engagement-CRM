from heapq import heappop, heappush
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from helpers import (
    DISTRICT_LINK_TERMS,
    DISTRICT_SCORE_CEILING,
    EMAIL,
    MAX_DISTRICT_CONTACT_PAGES,
    MAX_DISTRICT_DEPTH,
    REJECT_LINK,
    canonical_url,
    clean,
    digits,
    normalize,
    related_sites,
    school_words,
)
from models import Contact


class DistrictContactScraper:
    def __init__(self, http, parser):
        self.http = http
        self.parser = parser

    @staticmethod
    def district_seed(resolution):
        for item in reversed(resolution.trace):
            if item.get("scope") != "district" or item.get("error"):
                continue
            url = canonical_url(item.get("final_url") or item.get("url"), allow_blocked=True)
            if url:
                return url
        return canonical_url(resolution.fallback_url or resolution.seed_url, allow_blocked=True)

    @staticmethod
    def target_terms(school):
        words = tuple(school_words(school.name))
        phrase = " ".join(words)
        generic = {"academy", "campus", "community", "high", "junior", "middle", "public", "school", "senior"}
        distinctive = tuple(word for word in words if word not in generic and len(word) > 2)
        return phrase, distinctive

    @classmethod
    def names_school(cls, school, value):
        normalized = normalize(value)
        phrase, distinctive = cls.target_terms(school)
        if phrase and phrase in normalized:
            return True
        if not distinctive:
            return False
        hits = sum(word in normalized.split() for word in distinctive)
        return hits >= min(2, len(distinctive))

    @classmethod
    def different_school_named(cls, school, value):
        if cls.names_school(school, value):
            return False
        normalized = normalize(value)
        for peer in school.peer_names[:30]:
            words = school_words(peer)
            if words and " ".join(words) in normalized:
                return True
        return False

    @staticmethod
    def same_person(left, right):
        return bool(left and right and normalize(left) == normalize(right))

    @staticmethod
    def same_email(left, right):
        left_match = EMAIL.search(clean(left))
        right_match = EMAIL.search(clean(right))
        return bool(
            left_match
            and right_match
            and left_match.group(0).casefold() == right_match.group(0).casefold()
        )

    @staticmethod
    def same_phone(left, right):
        left_digits = digits(left)
        right_digits = digits(right)
        if len(left_digits) == 11 and left_digits.startswith("1"):
            left_digits = left_digits[1:]
        if len(right_digits) == 11 and right_digits.startswith("1"):
            right_digits = right_digits[1:]
        return bool(len(left_digits) == 10 and left_digits == right_digits)

    def assignment(self, school, item):
        text = item.get("container_text", "")
        if self.different_school_named(school, text):
            return 0.0, "different_school_named_in_district_record"
        if self.names_school(school, text):
            return 5.6, "district_record_names_school_review"
        if self.same_person(item.get("name", ""), school.administrator):
            return 5.2, "district_record_matches_official_administrator_review"
        if self.same_email(item.get("email", ""), school.directory_email):
            return 5.0, "district_record_matches_official_email_review"
        if self.same_phone(item.get("phone", "") or text, school.phone):
            return 4.6, "district_record_matches_school_phone_review"
        return 0.0, "district_school_assignment_not_proven"

    def extract(self, school, page):
        if not page.ok:
            return []

        raw = self.parser.structured(page) + self.parser.cards(page.text)
        output = []

        for item in raw:
            assignment, reason = self.assignment(school, item)
            if assignment <= 0.0:
                continue

            email_match = EMAIL.search(clean(item.get("email")))
            email = email_match.group(0).casefold() if email_match else ""
            phone = clean(item.get("phone"))
            extension = clean(item.get("extension"))
            if not (email or phone):
                continue

            method = item.get("method", "staff_card")
            extraction = 5.5 + (2.0 if method == "embedded_json" else 1.3)
            extraction += 1.0 if email else 0.0
            extraction += 0.4 if phone else 0.0
            score = round(min(DISTRICT_SCORE_CEILING, 0.58 * extraction + 0.42 * assignment), 2)

            output.append(Contact(
                name=clean(item.get("name")),
                title=clean(item.get("title")),
                role=clean(item.get("role")),
                email=email,
                phone=phone,
                extension=extension,
                department=clean(item.get("department")),
                source_url=page.url,
                method=f"district_{method}",
                extraction_score=round(extraction, 2),
                assignment_score=assignment,
                score=score,
                assignment_reason=reason,
            ))

        return self.parser.deduplicate(output)

    @classmethod
    def rank_links(cls, school, page):
        soup = BeautifulSoup(page.text, "html.parser")
        ranked = {}

        for link in soup.find_all("a", href=True)[:2_000]:
            url = canonical_url(link.get("href"), page.url, allow_blocked=True)
            if not url or not related_sites(url, page.url):
                continue
            text = normalize(link.get_text(" ", strip=True) + " " + urlsplit(url).path)
            score = sum(points for term, points in DISTRICT_LINK_TERMS.items() if term in text)
            if cls.names_school(school, text):
                score += 16
            if REJECT_LINK.search(text):
                score -= 8
            if score > 0:
                ranked[url] = max(score, ranked.get(url, 0.0))

        return sorted(((score, url) for url, score in ranked.items()), reverse=True)

    @staticmethod
    def guesses(seed):
        base = seed.rstrip("/") + "/"
        paths = ("staff", "staff-directory", "directory", "administration", "schools", "contact")
        output = []
        for path in paths:
            url = canonical_url(path, base, allow_blocked=True)
            if url:
                output.append(url)
        return output

    def scrape(self, school, resolution):
        if resolution.resolved or resolution.reason not in {
            "district found but no valid school route",
            "district_found_but_no_valid_school_route",
        }:
            return [], []

        seed = self.district_seed(resolution)
        if not seed:
            return [], []

        queue = []
        counter = 0

        def add(score, url, depth):
            nonlocal counter
            counter += 1
            heappush(queue, (-score, counter, url, depth))

        add(100.0, seed, 0)
        for guess in self.guesses(seed):
            add(2.0, guess, 1)

        seen = set()
        contacts = []
        pages = []

        while queue and len(seen) < MAX_DISTRICT_CONTACT_PAGES:
            _, _, url, depth = heappop(queue)
            if url in seen or depth > MAX_DISTRICT_DEPTH:
                continue
            seen.add(url)

            page = self.http.get(url)
            if not page.ok:
                continue
            if page.url != seed and page.url not in pages:
                pages.append(page.url)

            contacts.extend(self.extract(school, page))

            if depth >= MAX_DISTRICT_DEPTH:
                continue
            for score, found in self.rank_links(school, page):
                if found not in seen:
                    add(score, found, depth + 1)

        return self.parser.deduplicate(contacts), pages
