from collections import Counter
from datetime import date, datetime, timedelta
import json
import re
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Tag

from district_contacts import DistrictContactScraper
from helpers import (
    CALENDAR_LINK_TERMS,
    CONTACT_CONTAINERS,
    CONTACT_LINK_TERMS,
    EMAIL,
    EVENT_PATTERNS,
    EVENT_REJECT,
    MESSAGE_NAME,
    PHONE,
    ROLE_ORDER,
    canonical_url,
    clean,
    digits,
    host_of,
    iter_json,
    json_documents,
    looks_like_person,
    normalize,
    normalized_role,
    parse_datetime,
    related_sites,
    school_words,
    split_phone,
)
from models import Contact, Event, SchoolResult


class ContactParser:
    @staticmethod
    def lines(node):
        output = []
        for value in node.stripped_strings:
            value = clean(value)
            if value and value not in output:
                output.append(value)
            if len(output) >= 24:
                break
        return output

    @staticmethod
    def signature(node):
        classes = tuple(sorted(
            value
            for value in node.get("class", [])[:6]
            if not re.fullmatch(r"(?:row|col(?:-\w+)?|container|wrapper|item|active)", value, re.I)
        ))
        children = tuple(child.name for child in node.children if isinstance(child, Tag))[:8]
        return (
            node.name,
            classes,
            children,
            bool(node.find("a", href=re.compile(r"^mailto:", re.I))),
            bool(node.find("img")),
        )

    @staticmethod
    def container_score(node, repeat_count=0):
        lines = ContactParser.lines(node)
        text = "\n".join(lines)
        if not lines or len(text) > 1_800:
            return -100.0

        roles = sum(bool(normalized_role(line)) for line in lines)
        names = sum(looks_like_person(line) or bool(MESSAGE_NAME.search(line)) for line in lines)
        emails = len(EMAIL.findall(text)) + len(node.find_all("a", href=re.compile(r"^mailto:", re.I)))

        score = min(3.0, repeat_count * 0.8)
        score += 3.0 if roles else 0.0
        score += 3.0 if names else 0.0
        score += 2.5 if emails else 0.0
        score += 0.8 if PHONE.search(text) else 0.0
        score += 1.0 if re.search(
            r"staff|person|employee|directory|contact|card|profile|member",
            " ".join(node.get("class", [])),
            re.I,
        ) else 0.0
        score += 0.8 if node.find(["h2", "h3", "h4", "strong", "b"]) else 0.0
        score -= 4.0 if names > 1 else 0.0
        score -= 4.0 if emails > 2 else 0.0
        score -= 3.0 if roles > 3 else 0.0
        return score

    def best_container(self, seed, repeats=None):
        choices = []
        node = seed

        for count in range(7):
            if node is None:
                break
            if node.name in CONTACT_CONTAINERS:
                repeat_count = (repeats or {}).get(self.signature(node), 0)
                choices.append((self.container_score(node, repeat_count), node))
            parent = node.parent
            node = parent if isinstance(parent, Tag) else None

        if not choices:
            return None, -100.0

        score, node = max(choices, key=lambda item: item[0])
        return node, score

    @staticmethod
    def email(node, text):
        link = node.find("a", href=re.compile(r"^mailto:", re.I))
        if link:
            match = EMAIL.search(link.get("href", ""))
            if match:
                return match.group(0).casefold()

        scripts = " ".join(script.get_text(" ", strip=True) for script in node.find_all("script"))
        hidden = re.search(
            r"insertEmail\(\s*[\"'][^\"']+[\"']\s*,\s*[\"']([^\"']+)[\"']\s*,\s*[\"']([^\"']+)[\"']",
            scripts,
            re.I,
        )
        if hidden:
            candidate = f"{hidden.group(2)[::-1]}@{hidden.group(1)[::-1]}".casefold()
            if EMAIL.fullmatch(candidate):
                return candidate

        match = EMAIL.search(text)
        return match.group(0).casefold() if match else ""

    @staticmethod
    def fields(node):
        lines = ContactParser.lines(node)
        text = "\n".join(lines)
        email = ContactParser.email(node, text)
        phone, extension = split_phone(text)
        titles = [line for line in lines if normalized_role(line) and not looks_like_person(line)]

        if not titles:
            return None

        title = min(
            titles,
            key=lambda line: (ROLE_ORDER.index(normalized_role(line)), lines.index(line), len(line)),
        )
        role = normalized_role(title)
        title_index = lines.index(title)
        names = []

        for index, line in enumerate(lines):
            message = MESSAGE_NAME.search(line)
            if message and looks_like_person(message.group("name")):
                names.append((3.0, -abs(index - title_index), -len(line), message.group("name")))

            if looks_like_person(line):
                local = normalize(email.split("@", 1)[0].replace(".", " ")) if email else ""
                parts = [normalize(part) for part in line.split()]
                affinity = sum(part in local for part in parts) / max(1, len(parts))
                names.append((affinity, -abs(index - title_index), -len(line), line))

        if not names:
            return None

        name = max(names)[3]
        if normalize(name) == normalize(title):
            return None

        department = ""
        for line in lines:
            if line in {name, title} or EMAIL.search(line) or PHONE.search(line) or normalized_role(line):
                continue
            if len(line.split()) <= 8 and len(line) <= 80 and not looks_like_person(line):
                department = line
                break

        return {
            "name": name,
            "title": title,
            "role": role,
            "email": email,
            "phone": phone,
            "extension": extension,
            "department": department,
            "container_text": clean(text)[:1_500],
        }

    def cards(self, html):
        soup = BeautifulSoup(html, "html.parser")
        seeds = []

        for node in soup.find_all(True):
            if len(seeds) >= 700:
                break
            href = clean(node.get("href")).casefold()
            own_text = clean(node.get_text(" ", strip=True))
            if (
                href.startswith(("mailto:", "tel:"))
                or MESSAGE_NAME.search(own_text)
                or (len(own_text) <= 120 and normalized_role(own_text))
            ):
                seeds.append(node)

        first = []
        seen = set()
        for seed in seeds:
            node, score = self.best_container(seed)
            if node is not None and score >= 4.0 and id(node) not in seen:
                seen.add(id(node))
                first.append(node)

        repeats = Counter(self.signature(node) for node in first)
        output = []
        seen.clear()

        for node in first:
            best, score = self.best_container(node, repeats)
            if best is None or score < 5.5 or id(best) in seen:
                continue
            seen.add(id(best))
            values = self.fields(best)
            if values:
                values["method"] = "repeated_staff_card" if repeats[self.signature(best)] >= 2 else "staff_card"
                output.append(values)

        return output

    @staticmethod
    def structured(page):
        output = []

        for document in json_documents(page):
            for row in iter_json(document):
                lowered = {normalize(key).replace(" ", ""): value for key, value in row.items()}
                name = clean(next((lowered[key] for key in ("name", "fullname", "displayname", "staffname") if key in lowered), ""))
                title = clean(next((lowered[key] for key in ("jobtitle", "position", "title", "role") if key in lowered), ""))
                role = normalized_role(title)
                email = clean(next((lowered[key] for key in ("email", "emailaddress", "mail") if key in lowered), ""))
                phone = clean(next((lowered[key] for key in ("phone", "telephone", "phonenumber") if key in lowered), ""))

                if not (name and role and looks_like_person(name) and (email or phone)):
                    continue

                normalized_phone, extension = split_phone(phone)
                email_match = EMAIL.search(email)
                output.append({
                    "name": name,
                    "title": title,
                    "role": role,
                    "email": email_match.group(0).casefold() if email_match else "",
                    "phone": normalized_phone,
                    "extension": extension,
                    "department": clean(next((lowered[key] for key in ("department", "school", "location", "building") if key in lowered), "")),
                    "container_text": clean(json.dumps(row, ensure_ascii=False))[:1_500],
                    "method": "embedded_json",
                })

        return output

    @staticmethod
    def under_school_route(source, home):
        if not related_sites(source, home):
            return False
        source_path = urlsplit(source).path.rstrip("/")
        home_path = urlsplit(home).path.rstrip("/")
        if home_path:
            return source_path == home_path or source_path.startswith(home_path + "/")
        return host_of(source) == host_of(home)

    def assignment(self, school, page, resolution, text, inherited_school):
        normalized_text = normalize(text)
        school_name = " ".join(school_words(school.name))

        for peer in school.peer_names[:30]:
            peer_name = " ".join(school_words(peer))
            if peer_name and peer_name in normalized_text and school_name not in normalized_text:
                return 2.0, "different_school_named_in_record"

        if school_name and school_name in normalized_text:
            return 9.5, "contact_record_names_school"
        if self.under_school_route(page.url, resolution.resolved_url):
            return 9.0, "under_verified_school_route"
        if inherited_school and related_sites(page.url, resolution.resolved_url):
            return 8.4, "discovered_from_verified_school_page"
        return 3.0, "school_assignment_not_proven"

    def extract(self, school, resolution, page, inherited_school=False):
        if not page.ok or not resolution.resolved:
            return []

        raw = self.structured(page) + self.cards(page.text)
        output = []

        for item in raw:
            role = item.get("role") or normalized_role(item.get("title", ""))
            if not role or not looks_like_person(item.get("name", "")):
                continue

            email_match = EMAIL.search(clean(item.get("email")))
            email = email_match.group(0).casefold() if email_match else ""
            phone = clean(item.get("phone"))
            extension = clean(item.get("extension"))
            if not phone:
                phone, extension = split_phone(item.get("container_text", ""))
            if not (email or phone):
                continue

            assignment, reason = self.assignment(
                school,
                page,
                resolution,
                item.get("container_text", ""),
                inherited_school,
            )
            extraction = 5.5 + (2.0 if item.get("method") == "embedded_json" else 1.3)
            extraction += 1.0 if email else 0.0
            extraction += 0.4 if phone else 0.0
            score = round(min(10.0, 0.58 * extraction + 0.42 * assignment), 2)

            if assignment < 8.0 or score < 7.0:
                continue

            output.append(Contact(
                name=clean(item["name"]),
                title=clean(item["title"]),
                role=role,
                email=email,
                phone=phone,
                extension=extension,
                department=clean(item.get("department")),
                source_url=page.url,
                method=item.get("method", "staff_card"),
                extraction_score=round(extraction, 2),
                assignment_score=assignment,
                score=score,
                assignment_reason=reason,
            ))

        return self.deduplicate(output)

    @staticmethod
    def authority(school, resolution):
        title = school.administrator_title or "Principal"
        role = normalized_role(title)
        if not role or not looks_like_person(school.administrator):
            return []

        email_match = EMAIL.search(school.directory_email)
        email = email_match.group(0).casefold() if email_match else ""
        phone, extension = split_phone(school.phone)
        if not (email or phone):
            return []

        return [Contact(
            name=school.administrator,
            title=title,
            role=role,
            email=email,
            phone=phone,
            extension=extension,
            source_url=school.data_source,
            method="official_state_record",
            extraction_score=5.0,
            assignment_score=4.5,
            score=4.8,
            assignment_reason="official roster soft fallback",
        )]

    @staticmethod
    def deduplicate(contacts):
        best = {}
        for contact in contacts:
            key = contact.email or f"{normalize(contact.name)}|{contact.role}|{digits(contact.phone)}"
            if key not in best or contact.score > best[key].score:
                best[key] = contact
        rank = {role: index for index, role in enumerate(ROLE_ORDER)}
        return sorted(best.values(), key=lambda item: (rank.get(item.role, 99), -item.score, item.name))


class EventParser:
    def category(self, text):
        text = clean(text)
        if EVENT_REJECT.search(text):
            return ""
        if re.search(r"\bSAT\b", text):
            return "testing"
        if re.search(r"\bSat\b", text) and not re.search(
            r"\b(?:exam|test|testing|assessment|administration|school day)\b",
            text,
            re.I,
        ):
            text = re.sub(r"\bSat\b", "", text)
        if re.search(r"\bsat\s+(?:exam|test|testing|assessment|administration|school\s+day)\b", text, re.I):
            return "testing"
        for category, pattern in EVENT_PATTERNS.items():
            if pattern.search(text):
                return category
        return ""

    @staticmethod
    def in_window(value):
        if value is None:
            return False
        return date.today() <= value.date() <= date.today() + timedelta(days=365)

    def make(self, school, page, title, start, end="", location="", description="", method="", inherited_school=False):
        title = clean(title)
        start_date = parse_datetime(start)
        if not title or not self.in_window(start_date):
            return None

        combined = " ".join((title, clean(location), clean(description)))
        category = self.category(combined)
        if not category:
            return None

        names_school = " ".join(school_words(school.name)) in " ".join(school_words(combined))
        if not inherited_school and not names_school:
            return None

        end_date = parse_datetime(end)
        score = 5.5 + (1.5 if method in {"ics_feed", "embedded_json"} else 0.5)
        score += 1.0 if names_school else 0.0

        return Event(
            title=title,
            start=start_date.isoformat(),
            end=end_date.isoformat() if end_date else "",
            location=clean(location),
            description=clean(description)[:800],
            category=category,
            source_url=page.url,
            method=method,
            score=round(min(10.0, score), 2),
        )

    def structured(self, school, page, inherited_school):
        output = []

        for document in json_documents(page):
            for row in iter_json(document):
                lowered = {normalize(key).replace(" ", ""): value for key, value in row.items()}
                title = next((lowered[key] for key in ("name", "title", "summary", "eventname") if key in lowered), "")
                start = next((lowered[key] for key in ("startdate", "start", "date", "starttime") if key in lowered), "")
                if not title or not start:
                    continue

                event = self.make(
                    school,
                    page,
                    title=title,
                    start=start,
                    end=next((lowered[key] for key in ("enddate", "end", "endtime") if key in lowered), ""),
                    location=next((lowered[key] for key in ("location", "place", "venue") if key in lowered), ""),
                    description=next((lowered[key] for key in ("description", "details") if key in lowered), ""),
                    method="embedded_json",
                    inherited_school=inherited_school,
                )
                if event:
                    output.append(event)

        return output

    @staticmethod
    def unfold_ics(text):
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        output = []
        for line in lines:
            if line.startswith((" ", "\t")) and output:
                output[-1] += line[1:]
            else:
                output.append(line)
        return output

    @staticmethod
    def ics_value(fields, name):
        for key, value in fields.items():
            if key.split(";", 1)[0].upper() == name:
                return value.replace("\\n", " ").replace("\\,", ",").replace("\\;", ";")
        return ""

    def ics(self, school, page, inherited_school):
        components = []
        current = None

        for line in self.unfold_ics(page.text):
            if line.upper() == "BEGIN:VEVENT":
                current = {}
            elif line.upper() == "END:VEVENT":
                if current is not None:
                    components.append(current)
                current = None
            elif current is not None and ":" in line:
                key, value = line.split(":", 1)
                current[key] = value

        output = []
        for fields in components[:5_000]:
            start = parse_datetime(self.ics_value(fields, "DTSTART"))
            if start is None:
                continue

            dates = [start]
            rule = self.ics_value(fields, "RRULE")
            if rule:
                values = dict(part.split("=", 1) for part in rule.split(";") if "=" in part)
                frequency = values.get("FREQ", "").upper()
                try:
                    interval = max(1, int(values.get("INTERVAL", "1") or 1))
                except ValueError:
                    interval = 1

                if frequency in {"DAILY", "WEEKLY", "MONTHLY"}:
                    days = interval if frequency == "DAILY" else 7 * interval if frequency == "WEEKLY" else 28 * interval
                    step = timedelta(days=days)
                    dates = []
                    current_date = start
                    try:
                        count = min(400, int(values.get("COUNT", "400") or 400))
                    except ValueError:
                        count = 400
                    for index in range(count):
                        if current_date.date() > date.today() + timedelta(days=365):
                            break
                        if self.in_window(current_date):
                            dates.append(current_date)
                        current_date += step

            for event_date in dates:
                event = self.make(
                    school,
                    page,
                    title=self.ics_value(fields, "SUMMARY"),
                    start=event_date,
                    end=self.ics_value(fields, "DTEND"),
                    location=self.ics_value(fields, "LOCATION"),
                    description=self.ics_value(fields, "DESCRIPTION"),
                    method="ics_feed",
                    inherited_school=inherited_school,
                )
                if event:
                    output.append(event)

        return output

    def html(self, school, page, inherited_school):
        soup = BeautifulSoup(page.text, "html.parser")
        output = []

        for time_node in soup.find_all("time")[:500]:
            start = clean(time_node.get("datetime") or time_node.get_text(" ", strip=True))
            card = time_node

            for count in range(5):
                parent = card.parent
                if not isinstance(parent, Tag):
                    break
                card = parent
                words = len(card.get_text(" ", strip=True).split())
                if 4 <= words <= 100:
                    break

            title_node = card.find(["h2", "h3", "h4", "strong", "a"])
            if title_node:
                title = clean(title_node.get_text(" ", strip=True))
            else:
                title = clean(card.get_text(" ", strip=True).replace(time_node.get_text(" ", strip=True), ""))[:160]

            event = self.make(
                school,
                page,
                title=title,
                start=start,
                description=card.get_text(" ", strip=True),
                method="html_time",
                inherited_school=inherited_school,
            )
            if event:
                output.append(event)

        return output

    def extract(self, school, page, inherited_school):
        lower = page.text[:5_000].casefold()
        if (
            page.url.casefold().endswith((".ics", ".ical"))
            or "text/calendar" in page.content_type.casefold()
            or "begin:vcalendar" in lower
        ):
            return self.ics(school, page, inherited_school)
        return self.structured(school, page, inherited_school) + self.html(school, page, inherited_school)

    @staticmethod
    def deduplicate(events):
        priority = {"ics_feed": 3, "embedded_json": 2, "html_time": 1}
        best = {}
        for event in events:
            key = f"{normalize(event.title)}|{event.start[:10]}"
            old = best.get(key)
            if old is None or (priority.get(event.method, 0), event.score) > (priority.get(old.method, 0), old.score):
                best[key] = event
        return sorted(best.values(), key=lambda item: (item.start, item.title))


class SchoolScraper:
    def __init__(self, http):
        self.http = http
        self.contacts = ContactParser()
        self.district_contacts = DistrictContactScraper(http, self.contacts)
        self.events = EventParser()

    def authority_only(self, school, resolution, error=""):
        return SchoolResult(
            school=school,
            resolution=resolution,
            contacts=self.contacts.authority(school, resolution),
            error=error,
        )

    @staticmethod
    def rank_links(page, terms, school, resolution):
        soup = BeautifulSoup(page.text, "html.parser")
        ranked = {}

        for link in soup.find_all("a", href=True)[:2_000]:
            url = canonical_url(link.get("href"), page.url, allow_blocked=True)
            if not url:
                continue

            text = normalize(link.get_text(" ", strip=True) + " " + urlsplit(url).path)
            score = sum(points for term, points in terms.items() if term in text)
            if any(word in text for word in ("athletics", "employment", "food", "lunch", "board", "news")):
                score -= 8
            if score <= 0:
                continue

            home_path = urlsplit(resolution.resolved_url).path.rstrip("/")
            source_path = urlsplit(url).path.rstrip("/")
            under_route = related_sites(url, resolution.resolved_url) and (
                (home_path and (source_path == home_path or source_path.startswith(home_path + "/")))
                or (not home_path and host_of(url) == host_of(resolution.resolved_url))
            )

            old = ranked.get(url)
            value = (float(score), under_route)
            if old is None or value[0] > old[0]:
                ranked[url] = value

        return sorted(
            ((score, url, inherited) for url, (score, inherited) in ranked.items()),
            reverse=True,
        )

    @staticmethod
    def api_links(page, kind):
        expanded = page.text.replace("\\/", "/").replace("\\u002F", "/").replace("\\u003A", ":")
        words = (
            "staff",
            "directory",
            "employee",
            "counsel",
            "career",
            "social-work",
            "student-services",
        ) if kind == "contact" else ("event", "calendar", ".ics")
        output = []

        for raw in re.findall(r"(?:https?://[^\s\"'<>]+|/[A-Za-z0-9_?&=./%\-]+)", expanded, re.I):
            if not any(word in raw.casefold() for word in words):
                continue
            url = canonical_url(raw.rstrip(",;)]}"), page.url, allow_blocked=True)
            if not url:
                continue
            known_apptegy = "thrillshare" in host_of(url) and kind == "calendar"
            if related_sites(url, page.url) or known_apptegy:
                output.append(url)

        return list(dict.fromkeys(output))[:4]

    @staticmethod
    def guesses(resolution, kind):
        base = resolution.resolved_url.rstrip("/") + "/"
        if kind == "contact":
            platform_paths = {
                "apptegy": ("staff", "page/staff-directory", "page/counseling"),
                "edlio": ("apps/staff", "staff", "apps/pages/administration"),
                "finalsite": ("directory", "staff-directory", "counseling"),
                "schoolmessenger": ("staff-directory", "administration", "school-counseling"),
                "wordpress": ("staff", "administration", "counseling"),
            }.get(resolution.platform, ("staff", "staff-directory", "administration", "counseling"))
            student_paths = (
                "college-career",
                "guidance",
                "student-services",
                "student-support",
                "social-work",
                "registrar",
            )
            paths = (*platform_paths, *student_paths)
        else:
            paths = ("calendar", "events", "events.ics")

        output = []
        for path in paths:
            url = canonical_url(path, base, allow_blocked=True)
            if url:
                output.append(url)
        return output

    @staticmethod
    def finalsite_search(page, school):
        if "fsConstituent" not in page.text or "const_search_keyword" not in page.text or not school.administrator:
            return ""
        parsed = urlsplit(page.url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        query["const_search_keyword"] = [school.administrator.split()[-1]]
        query.pop("const_page", None)
        return canonical_url(
            urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query, doseq=True), "")),
            allow_blocked=True,
        )

    def scrape(self, school, resolution):
        authority = self.contacts.authority(school, resolution)

        if not resolution.resolved:
            district_contacts, contact_pages = self.district_contacts.scrape(school, resolution)
            district_contacts.extend(authority)
            return SchoolResult(
                school=school,
                resolution=resolution,
                contacts=self.contacts.deduplicate(district_contacts),
                contact_pages=contact_pages,
            )

        homepage = self.http.get(resolution.resolved_url)
        if not homepage.ok:
            return SchoolResult(
                school,
                resolution,
                contacts=authority,
                error=homepage.error or f"http_{homepage.status}",
            )

        contact_candidates = self.rank_links(homepage, CONTACT_LINK_TERMS, school, resolution)
        calendar_candidates = self.rank_links(homepage, CALENDAR_LINK_TERMS, school, resolution)
        contact_candidates.extend((13.0, url, True) for url in self.api_links(homepage, "contact"))
        calendar_candidates.extend((13.0, url, True) for url in self.api_links(homepage, "calendar"))
        contact_candidates.extend((2.0, url, True) for url in self.guesses(resolution, "contact"))
        calendar_candidates.extend((2.0, url, True) for url in self.guesses(resolution, "calendar"))

        finalsite = self.finalsite_search(homepage, school)
        if finalsite:
            contact_candidates.append((14.0, finalsite, True))

        contacts = self.contacts.extract(school, resolution, homepage, inherited_school=True)
        events = self.events.extract(school, homepage, inherited_school=True)
        contact_pages = []
        calendar_pages = []
        seen = {homepage.url}

        for score, url, inherited in sorted(contact_candidates, reverse=True):
            if url in seen or len(contact_pages) >= 8:
                continue
            seen.add(url)
            page = self.http.get(url)
            if not page.ok:
                continue
            contact_pages.append(page.url)
            contacts.extend(self.contacts.extract(school, resolution, page, inherited_school=inherited))

        for score, url, inherited in sorted(calendar_candidates, reverse=True):
            if url in seen or len(calendar_pages) >= 5:
                continue
            seen.add(url)
            page = self.http.get(url)
            if not page.ok:
                continue
            calendar_pages.append(page.url)
            events.extend(self.events.extract(school, page, inherited_school=inherited))

        contacts.extend(authority)
        return SchoolResult(
            school=school,
            resolution=resolution,
            contacts=self.contacts.deduplicate(contacts),
            events=self.events.deduplicate(events),
            contact_pages=contact_pages,
            calendar_pages=calendar_pages,
        )
