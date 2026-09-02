from datetime import date, datetime, timedelta
import json
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from helpers import (
    IACAC_CALENDAR_URL,
    IACAC_DATE_FORMATS,
    IACAC_DESCRIPTION_FIELDS,
    IACAC_END_FIELDS,
    IACAC_EVENTS_API_URL,
    IACAC_KNACK_APP_ID,
    IACAC_KNACK_SCENE,
    IACAC_KNACK_VIEW,
    IACAC_LOCATION_FIELDS,
    IACAC_MAX_PAGES,
    IACAC_START_FIELDS,
    IACAC_TITLE_FIELDS,
    clean,
    iter_json,
    json_documents,
    normalize,
)
from models import Event


class IacacEventSource:
    def __init__(
        self,
        http,
        calendar_url=IACAC_CALENDAR_URL,
        api_url=IACAC_EVENTS_API_URL,
        app_id=IACAC_KNACK_APP_ID,
        scene=IACAC_KNACK_SCENE,
        view=IACAC_KNACK_VIEW,
        max_pages=IACAC_MAX_PAGES,
    ):
        self.http = http
        self.calendar_url = calendar_url
        self.api_url = api_url
        self.app_id = app_id
        self.scene = scene
        self.view = view
        self.max_pages = max_pages
        self.last_error = ""

    @staticmethod
    def query(url, **updates):
        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query.update({key: str(value) for key, value in updates.items()})
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))

    @staticmethod
    def page_json(page):
        try:
            return json.loads(page.text)
        except (TypeError, json.JSONDecodeError):
            return None

    @staticmethod
    def records(document):
        if isinstance(document, list):
            return [item for item in document if isinstance(item, dict)]
        if not isinstance(document, dict):
            return []
        for key in ("records", "results", "events", "data"):
            value = document.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    @staticmethod
    def field_labels(document):
        labels = {}
        if document is None:
            return labels
        for item in iter_json(document):
            key = clean(item.get("field_key") or item.get("key"))
            label = clean(item.get("label") or item.get("name") or item.get("title"))
            if re.fullmatch(r"field_\d+", key) and label and label != key:
                labels[key] = label
        return labels

    @staticmethod
    def find_identifier(text, names, pattern):
        for name in names:
            match = re.search(
                rf"[\"']?{re.escape(name)}[\"']?\s*[:=]\s*[\"']({pattern})[\"']",
                text,
                re.I,
            )
            if match:
                return match.group(1)
        return ""

    def discover(self, page):
        documents = json_documents(page)
        labels = {}
        for document in documents:
            labels.update(self.field_labels(document))

        text = page.text.replace("\\\"", '"')
        app_id = self.app_id or self.find_identifier(
            text,
            ("application_id", "applicationId", "app_id", "appId"),
            r"[A-Za-z0-9_-]{12,64}",
        )
        scene = self.scene or self.find_identifier(
            text,
            ("scene", "scene_key", "sceneKey", "key"),
            r"scene_\d+",
        )
        view = self.view or self.find_identifier(
            text,
            ("view", "view_key", "viewKey", "key"),
            r"view_\d+",
        )
        if not scene:
            match = re.search(r"\bscene_\d+\b", text)
            scene = match.group(0) if match else ""
        if not view:
            match = re.search(r"\bview_\d+\b", text)
            view = match.group(0) if match else ""

        if app_id and scene and view:
            endpoint = f"https://api.knack.com/v1/pages/{scene}/views/{view}/records"
            return endpoint, app_id, labels
        return "", app_id, labels

    def api_documents(self, url, app_id=""):
        headers = {}
        if app_id:
            headers = {
                "X-Knack-Application-Id": app_id,
                "X-Knack-REST-API-Key": "knack",
            }

        output = []
        for number in range(1, self.max_pages + 1):
            page = self.http.get(
                self.query(url, page=number, rows_per_page=1000, format="raw"),
                headers=headers or None,
            )
            if not page.ok:
                self.last_error = page.error or f"http_{page.status}"
                break
            document = self.page_json(page)
            if document is None:
                self.last_error = "invalid_json"
                break
            output.append(document)

            total_pages = document.get("total_pages", 1) if isinstance(document, dict) else 1
            try:
                if number >= int(total_pages or 1):
                    break
            except (TypeError, ValueError):
                break
        return output

    @staticmethod
    def plain(value):
        if value is None:
            return ""
        if isinstance(value, (str, int, float)):
            return clean(value)
        if isinstance(value, list):
            return clean(" | ".join(IacacEventSource.plain(item) for item in value))
        if isinstance(value, dict):
            if value.get("iso_timestamp"):
                return IacacEventSource.plain(value["iso_timestamp"])
            if value.get("date"):
                return clean(
                    f"{IacacEventSource.plain(value['date'])} "
                    f"{IacacEventSource.plain(value.get('time'))}"
                )
            if any(value.get(key) for key in ("street", "city", "state", "zip")):
                return clean(
                    ", ".join(
                        IacacEventSource.plain(value.get(key))
                        for key in ("street", "city", "state", "zip")
                        if value.get(key)
                    )
                )
            preferred = (
                "formatted",
                "label",
                "name",
                "url",
            )
            values = [IacacEventSource.plain(value.get(key)) for key in preferred if value.get(key)]
            if not values:
                values = [IacacEventSource.plain(item) for item in value.values()]
            return clean(" | ".join(dict.fromkeys(item for item in values if item)))
        return clean(value)

    @classmethod
    def fields(cls, record, labels):
        output = {}
        for key, value in record.items():
            if key.endswith("_raw"):
                base = key[:-4]
                label = labels.get(base, base)
            else:
                label = labels.get(key, key)
            normalized = normalize(label)
            plain = cls.plain(value)
            if plain and (normalized not in output or key.endswith("_raw")):
                output[normalized] = plain
        return output

    @staticmethod
    def pick(fields, names):
        for name in names:
            value = fields.get(normalize(name))
            if value:
                return value
        for name in names:
            target = normalize(name)
            for key, value in fields.items():
                if target in key and value:
                    return value
        return ""

    @classmethod
    def event_datetime(cls, value):
        value = clean(value)
        if not value:
            return None
        candidates = [value]
        candidates.extend(part.strip() for part in value.split("|") if part.strip())
        for candidate in candidates:
            try:
                result = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
                return result.replace(tzinfo=None)
            except ValueError:
                pass
            for pattern in IACAC_DATE_FORMATS:
                try:
                    return datetime.strptime(candidate, pattern)
                except ValueError:
                    continue
        return None

    @classmethod
    def event(cls, record, labels, source_url):
        fields = cls.fields(record, labels)
        title = cls.pick(fields, IACAC_TITLE_FIELDS)
        start = cls.event_datetime(cls.pick(fields, IACAC_START_FIELDS))
        if not title or start is None:
            return None
        if not date.today() <= start.date() <= date.today() + timedelta(days=365):
            return None

        end = cls.event_datetime(cls.pick(fields, IACAC_END_FIELDS))
        location = cls.pick(fields, IACAC_LOCATION_FIELDS)
        description = cls.pick(fields, IACAC_DESCRIPTION_FIELDS)
        record_id = clean(record.get("id") or record.get("record_id"))
        if record_id:
            detail_url = (
                source_url.split("#", 1)[0].rstrip("/")
                + f"#list/viewcollegefairdetails/{record_id}/"
            )
        else:
            detail_url = source_url
        return Event(
            title=title,
            start=start.isoformat(),
            end=end.isoformat() if end else "",
            location=location,
            description=description[:800],
            category="college_planning",
            source_url=detail_url,
            method="iacac_knack_api",
            score=8.0,
        )

    @classmethod
    def html_records(cls, page):
        soup = BeautifulSoup(page.text, "html.parser")
        output = []
        seen = set()
        for node in soup.select("[data-record-id], tr, article, .kn-list-item")[:2_000]:
            text = clean(node.get_text(" | ", strip=True))
            if not text or text in seen:
                continue
            seen.add(text)
            time_node = node.find("time")
            start = clean(time_node.get("datetime") if time_node else "")
            if not start:
                match = re.search(
                    r"\b(?:\d{1,2}/\d{1,2}/\d{4}|"
                    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
                    r"[a-z]*\s+\d{1,2},\s+\d{4})"
                    r"(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?",
                    text,
                    re.I,
                )
                start = match.group(0) if match else ""
            title_node = node.find(["h2", "h3", "h4", "a"])
            title = clean(title_node.get_text(" ", strip=True) if title_node else "")
            if title and start:
                output.append({
                    "id": clean(node.get("data-record-id")),
                    "fair name": title,
                    "date": start,
                    "details": text,
                })
        return output

    @staticmethod
    def deduplicate(events):
        best = {}
        for event in events:
            key = (normalize(event.title), event.start[:16], normalize(event.location))
            if key not in best or event.score > best[key].score:
                best[key] = event
        return sorted(best.values(), key=lambda item: (item.start, item.title))

    def load(self):
        self.last_error = ""
        labels = {}
        documents = []

        if self.api_url:
            documents = self.api_documents(self.api_url, self.app_id)
        else:
            page = self.http.get(self.calendar_url)
            if not page.ok:
                self.last_error = page.error or f"http_{page.status}"
                return []

            direct = self.page_json(page)
            if direct is not None and self.records(direct):
                documents = [direct]
                labels.update(self.field_labels(direct))
            else:
                discovered_url, app_id, discovered_labels = self.discover(page)
                labels.update(discovered_labels)
                if discovered_url:
                    documents = self.api_documents(discovered_url, app_id)
                if not documents:
                    documents = [{"records": self.html_records(page)}]

        events = []
        for document in documents:
            labels.update(self.field_labels(document))
            for record in self.records(document):
                event = self.event(record, labels, self.calendar_url)
                if event:
                    events.append(event)
        events = self.deduplicate(events)
        if not events and not self.last_error:
            self.last_error = "no_current_records_or_public_endpoint"
        return events
