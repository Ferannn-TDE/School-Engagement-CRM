from collections import defaultdict
from dataclasses import asdict, fields, is_dataclass
from datetime import date, datetime, time as day_time, timezone
from hashlib import sha256
from html import unescape
from ipaddress import ip_address
import json
import os
from pathlib import Path
import re
import unicodedata
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup


USER_AGENT = "SchoolOutreachBot"
MAX_BODY_BYTES = 2_500_000
MAX_PAGES = 12
MAX_DEPTH = 2
PER_HOST_DELAY = 0.12
DISTRICT_SCORE_CEILING = 5.9
MAX_DISTRICT_CONTACT_PAGES = 8
MAX_DISTRICT_DEPTH = 2
CONTACT_CONTAINERS = {"article", "aside", "div", "li", "section", "td", "tr"}
OUTPUT_FOLDER = "output"
UPLOAD_DATABASE = True
USE_BROWSER = False
WORKERS = 6
SKIP = 0
RESOLVE_WINDOW = 48
DATABASE_MODE = "upsert"

IACAC_CALENDAR_URL = "https://iacac.knack.com/college-fairs#list"
IACAC_EVENTS_API_URL = os.environ.get("IACAC_EVENTS_API_URL", "")
IACAC_KNACK_APP_ID = os.environ.get("IACAC_KNACK_APP_ID", "")
IACAC_KNACK_SCENE = os.environ.get("IACAC_KNACK_SCENE", "")
IACAC_KNACK_VIEW = os.environ.get("IACAC_KNACK_VIEW", "")
IACAC_MAX_PAGES = 10
IACAC_TITLE_FIELDS = ("fair name", "event name", "college fair", "name", "title")
IACAC_START_FIELDS = (
    "start date and time",
    "start date",
    "event date",
    "fair date",
    "date",
    "start",
)
IACAC_END_FIELDS = ("end date and time", "end date", "end", "finish")
IACAC_LOCATION_FIELDS = (
    "location",
    "venue",
    "host site",
    "host school",
    "school",
    "address",
)
IACAC_DESCRIPTION_FIELDS = (
    "description",
    "details",
    "fair type",
    "event type",
    "notes",
)
IACAC_DATE_FORMATS = (
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
    "%B %d, %Y %I:%M %p",
    "%B %d, %Y",
    "%b %d, %Y %I:%M %p",
    "%b %d, %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)
REFRESH_CONFIRMATION = "REFRESH-SCHOOLREACH"

STATE_NAMES = {
    "IL": "Illinois",
    "MO": "Missouri",
}

ISBE_DIRECTORY_URL = (
    "https://www.isbe.net/_layouts/Download.aspx?"
    "SourceUrl=%2FDocuments%2Fdir_ed_entities.xls"
)
MISSOURI_SCHOOLS_URL = (
    "https://gis.mo.gov/arcgis/rest/services/DESE/"
    "Missouri_Public_Schools/MapServer/0"
)
MISSOURI_DISTRICTS_URL = (
    "https://gis.mo.gov/arcgis/rest/services/DESE/"
    "schoolDistrict/MapServer/1"
)

EMPTY_VALUES = {
    "",
    "(pending)",
    "n/a",
    "na",
    "nan",
    "none",
    "not applicable",
    "not available",
    "null",
    "unknown",
}

BLOCKED_HOSTS = {
    "alumniclass.com",
    "app.teacherlists.com",
    "facebook.com",
    "greatschools.org",
    "highschools.com",
    "instagram.com",
    "linkedin.com",
    "midvid.com",
    "nfhsnetwork.com",
    "niche.com",
    "publicschoolreview.com",
    "revtrak.net",
    "schooldigger.com",
    "sideline.bsnsports.com",
    "themascotshop.jostens.com",
    "tiktok.com",
    "usnews.com",
    "x.com",
    "youtube.com",
}

SHORT_TO_LONG = {
    "acad": "academy",
    "alt": "alternative",
    "chtr": "charter",
    "comm": "community",
    "cty": "county",
    "elem": "elementary",
    "hs": "high school",
    "intl": "international",
    "jr": "junior",
    "prep": "preparatory",
    "sch": "school",
    "sci": "science",
    "sr": "senior",
    "tech": "technical",
    "twp": "township",
    "voc": "vocational",
    "wm": "william",
}

CONTENT_PATH_WORDS = {
    "alumni",
    "apps",
    "athletics",
    "blog",
    "calendar",
    "contact",
    "dining",
    "documents",
    "employment",
    "events",
    "feed",
    "fbla",
    "ffa",
    "food",
    "jobs",
    "library",
    "lunch",
    "media",
    "menu",
    "news",
    "page",
    "policies",
    "policy",
    "portal",
    "registration",
    "staff",
    "story",
    "tickets",
    "track",
}

GENERIC_NAME_WORDS = {
    "academy",
    "alternative",
    "campus",
    "charter",
    "college",
    "community",
    "high",
    "school",
    "secondary",
    "senior",
}

SOURCE_SCORES = {
    "school_seed": 3.0,
    "authority_website": 3.0,
    "apptegy_organization": 3.0,
    "named_school_link": 2.5,
    "serialized_navigation": 2.0,
    "district_seed": 1.5,
    "sitemap": 1.0,
    "route_guess": 0.0,
    "school_directory_hub": 1.0,
    "navigation_link": 0.5,
}

EMAIL = re.compile(r"\b[A-Z0-9._%+\-']+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE = re.compile(
    r"(?:\+?1[\s./-]*)?(?:\(\s*\d{3}\s*\)|\d{3})"
    r"[\s./-]*\d{3}[\s./-]*\d{4}"
    r"(?:\s*(?:x|ext\.?|extension)\s*\d{1,8})?",
    re.I,
)
MESSAGE_NAME = re.compile(
    r"\b(?:send\s+(?:an?\s+)?(?:email|message)\s+to|email)\s+"
    r"(?P<name>[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,4})\b",
    re.I,
)

ROLE_PATTERNS = {
    "college_career": re.compile(
        r"\b(?:college\s*(?:and|&|/)\s*career|college\s+(?:access|advisor)|"
        r"career\s+(?:advisor|counselor|coordinator)|postsecondary|future\s+center)\b",
        re.I,
    ),
    "social_worker": re.compile(
        r"\b(?:school\s+)?social\s+work(?:er)?\b",
        re.I,
    ),
    "counseling_lead": re.compile(
        r"\b(?:director|chair|lead|coordinator)\s+(?:of\s+)?(?:school\s+)?counsel(?:ing|ors?)\b",
        re.I,
    ),
    "counselor": re.compile(r"\b(?:school|guidance|academic)?\s*counselor\b", re.I),
    "graduation_transition": re.compile(
        r"\b(?:graduation|college|postsecondary|transition|student\s+success)\s+"
        r"(?:coach|advisor|specialist|coordinator)\b",
        re.I,
    ),
    "student_support": re.compile(
        r"\b(?:student\s+(?:support|services)|pupil\s+services)\s+"
        r"(?:director|coordinator|specialist|advisor|manager)\b",
        re.I,
    ),
    "registrar": re.compile(
        r"\bregistrar\b|\b(?:admissions|enrollment)\s+(?:coordinator|specialist|advisor)\b",
        re.I,
    ),
    "family_liaison": re.compile(
        r"\b(?:family|community|parent)\s+(?:liaison|coordinator|engagement\s+specialist)\b",
        re.I,
    ),
    "school_psychologist": re.compile(r"\bschool\s+psychologist\b", re.I),
    "dean": re.compile(r"\bdean(?:\s+of\s+(?:students|instruction|academics))?\b", re.I),
    "assistant_principal": re.compile(
        r"\b(?:assistant|associate|vice)\s+principal\b|"
        r"\bprincipal\s*[-/]?\s*(?:assistant|associate)\b",
        re.I,
    ),
    "principal": re.compile(r"\bprincipal\b|\bprincip\b|\bprin\.?\b", re.I),
    "administrator": re.compile(r"\badministrator\b", re.I),
}

REJECT_ROLE = re.compile(
    r"\badministrative\s+assistant\b|\bsecretary\b|\bsuperintendent\b|"
    r"\bteacher\b|\b(?:athletic|football|basketball|baseball|softball|"
    r"volleyball|soccer|tennis|wrestling)\s+coach\b|\bboard\s+member\b",
    re.I,
)

ROLE_ORDER = (
    "college_career",
    "social_worker",
    "counseling_lead",
    "counselor",
    "graduation_transition",
    "student_support",
    "registrar",
    "family_liaison",
    "school_psychologist",
    "dean",
    "assistant_principal",
    "principal",
    "administrator",
)

CONTACT_TITLE_MAX_CHARACTERS = 100
CONTACT_TITLE_MAX_WORDS = 12
CONTACT_INVALID_NAME = re.compile(
    r"\b(?:click here|find us|learn more|links?|message|powered by|resources?|"
    r"send a blue note|step[- ]by[- ]step|dashboard|title ix coordinator)\b",
    re.I,
)
CONTACT_INVALID_TITLE = re.compile(
    r"\b(?:click here|contact us|copyright|data warehouse|employee expense|"
    r"handbook|home page|learn more|nondiscrimination|"
    r"powered by|privacy policy|school district home|send (?:an? )?(?:email|message)|"
    r"step[- ]by[- ]step|student handbook|terms of use|view all|website)\b",
    re.I,
)
CONTACT_TITLE_WORDS = {
    "academic",
    "administrative",
    "administrator",
    "assistant",
    "associate",
    "career",
    "chair",
    "coach",
    "college",
    "community",
    "coordinator",
    "counselor",
    "dean",
    "director",
    "enrollment",
    "family",
    "guidance",
    "liaison",
    "postsecondary",
    "principal",
    "psychologist",
    "registrar",
    "school",
    "services",
    "social",
    "specialist",
    "student",
    "students",
    "support",
    "transition",
    "worker",
}
CONTACT_EXACT_TITLES = (
    (re.compile(r"^h\.?\s*s\.?\s+prin(?:cip(?:al)?)?\.?$", re.I), "High School Principal"),
    (re.compile(r"^prin(?:cip(?:al)?)?\.?$", re.I), "Principal"),
    (re.compile(r"^(?:asst\.?|assistant)\s+prin(?:cip(?:al)?)?\.?$", re.I), "Assistant Principal"),
    (re.compile(r"^(?:assoc\.?|associate)\s+prin(?:cip(?:al)?)?\.?$", re.I), "Associate Principal"),
    (re.compile(r"^vice\s+prin(?:cip(?:al)?)?\.?$", re.I), "Vice Principal"),
    (re.compile(r"^couns(?:elor|ellor)?\.?$", re.I), "School Counselor"),
    (re.compile(r"^(?:school|guidance|academic)\s+couns(?:elor|ellor)?\.?$", re.I), None),
    (re.compile(r"^dean(?:\s+of\s+(?:students|instruction|academics))?$", re.I), None),
    (re.compile(r"^college\s*(?:and|&|/)\s*career\s+(?:advisor|counselor|coordinator)$", re.I), None),
)

NAME_NOISE = {
    "administration",
    "academic",
    "advisor",
    "center",
    "coach",
    "college",
    "community",
    "coordinator",
    "corner",
    "counseling",
    "department",
    "departments",
    "directory",
    "district",
    "email",
    "essc",
    "family",
    "graduation",
    "hotline",
    "information",
    "liaison",
    "manager",
    "meeting",
    "office",
    "principal",
    "program",
    "psychologist",
    "registrar",
    "school",
    "schools",
    "services",
    "social",
    "specialist",
    "staff",
    "student",
    "support",
    "time",
    "transition",
    "worker",
}

CONTACT_LINK_TERMS = {
    "staff directory": 14,
    "staff": 8,
    "directory": 8,
    "college career": 16,
    "college and career": 16,
    "social work": 15,
    "student support": 14,
    "student services": 13,
    "counseling": 14,
    "guidance": 13,
    "registrar": 11,
    "family engagement": 9,
    "administration": 7,
    "leadership": 8,
    "contact": 5,
}

CALENDAR_LINK_TERMS = {
    "calendar": 10,
    "events": 8,
    "school calendar": 14,
    "college": 4,
    "career": 4,
}

EVENT_PATTERNS = {
    "college_planning": re.compile(r"\bcollege\s+(?:night|fair|planning|information|application)|\bcollege\s+and\s+career\b", re.I),
    "college_visit": re.compile(r"\bcollege\s+(?:visit|representative)|\bcampus\s+visit\b", re.I),
    "financial_aid": re.compile(r"\bFAFSA\b|\bfinancial\s+aid\b|\bscholarship\s+(?:night|workshop|deadline)\b", re.I),
    "testing": re.compile(r"\b(?:ACT|PSAT|AP)\s*(?:exam|test|testing|school\s+day|administration)?\b", re.I),
    "enrollment": re.compile(r"\bregistration\b|\benrollment\b|\bopen\s+house\b|\bfreshman\s+orientation\b", re.I),
    "graduation": re.compile(r"\bgraduation\b|\bcommencement\b", re.I),
}

EVENT_REJECT = re.compile(
    r"\b(?:varsity|junior\s+varsity|football|basketball|baseball|softball|volleyball|"
    r"soccer|tennis|wrestling|track\s+meet|lunch|menu|board\s+meeting|car\s+wash|"
    r"homecoming\s+(?:dance|bonfire)|concert|rehearsal)\b",
    re.I,
)

DISTRICT_LINK_TERMS = {
    "staff directory": 14,
    "school directory": 14,
    "college career": 16,
    "college and career": 16,
    "social work": 15,
    "student support": 14,
    "student services": 13,
    "counseling": 14,
    "guidance": 13,
    "registrar": 11,
    "family engagement": 9,
    "principals": 7,
    "administration": 7,
    "leadership": 8,
    "directory": 8,
    "staff": 7,
    "schools": 6,
    "contact": 4,
}

REJECT_LINK = re.compile(
    r"\bathletics\b|\bemployment\b|\bfood\b|\blunch\b|\bboard\b|"
    r"\bnews\b|\bcalendar\b|\bevents\b|\btransportation\b",
    re.I,
)

REFRESH_SQL = """
    TRUNCATE TABLE
        activities, programs, contacts, events, staff,
        schools, district, county, state
    RESTART IDENTITY CASCADE
"""

STATE_SQL = """
    INSERT INTO state (state_code, state_name) VALUES (%s, %s)
    ON CONFLICT (state_code) DO UPDATE SET
        state_name = EXCLUDED.state_name
"""

COUNTY_SQL = """
    INSERT INTO county (county_name, state_code) VALUES (%s, %s)
    ON CONFLICT (county_name, state_code) DO NOTHING
"""

DISTRICT_SQL = """
    INSERT INTO district (district_name, county_name, state_code)
    VALUES (%s, %s, %s)
    RETURNING district_id
"""

SCHOOL_SQL = """
    INSERT INTO schools (
        facility_key, name, district_id, phone, address, type_of_school,
        admin, city, zipcode, grades_served, website, county_name,
        is_scraped, is_active, notes, created_at, updated_at, enrollment,
        grade_range, data_source, is_verified, last_verified_at, priority_tier,
        state_code
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
    )
    ON CONFLICT (facility_key) DO UPDATE SET
        name = EXCLUDED.name,
        district_id = EXCLUDED.district_id,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        type_of_school = EXCLUDED.type_of_school,
        admin = EXCLUDED.admin,
        city = EXCLUDED.city,
        zipcode = EXCLUDED.zipcode,
        grades_served = EXCLUDED.grades_served,
        website = EXCLUDED.website,
        county_name = EXCLUDED.county_name,
        is_scraped = EXCLUDED.is_scraped,
        is_active = EXCLUDED.is_active,
        notes = EXCLUDED.notes,
        updated_at = EXCLUDED.updated_at,
        enrollment = EXCLUDED.enrollment,
        grade_range = EXCLUDED.grade_range,
        data_source = EXCLUDED.data_source,
        is_verified = EXCLUDED.is_verified,
        last_verified_at = EXCLUDED.last_verified_at,
        priority_tier = EXCLUDED.priority_tier,
        state_code = EXCLUDED.state_code
"""

STAFF_SQL = """
    INSERT INTO staff (
        name, phone, email, job_name, school_worked_at,
        is_scraped, is_active, notes, created_at, updated_at,
        data_source, is_verified, last_verified_at
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    RETURNING staff_id
"""

STAFF_FIND_EMAIL_SQL = """
    SELECT staff_id FROM staff
    WHERE school_worked_at = %s
      AND LOWER(name) = LOWER(%s)
      AND LOWER(email) = LOWER(%s)
    ORDER BY staff_id
    LIMIT 1
"""

STAFF_FIND_PHONE_SQL = """
    SELECT staff_id FROM staff
    WHERE school_worked_at = %s
      AND LOWER(name) = LOWER(%s)
      AND phone = %s
    ORDER BY staff_id
    LIMIT 1
"""

STAFF_FIND_NAME_SQL = """
    SELECT staff_id FROM staff
    WHERE school_worked_at = %s
      AND LOWER(name) = LOWER(%s)
      AND LOWER(job_name) = LOWER(%s)
    ORDER BY staff_id
    LIMIT 1
"""

STAFF_UPDATE_SQL = """
    UPDATE staff SET
        name = %s,
        phone = %s,
        email = %s,
        job_name = %s,
        school_worked_at = %s,
        is_active = %s,
        notes = %s,
        updated_at = %s,
        data_source = %s
    WHERE staff_id = %s
      AND is_scraped IS TRUE
      AND NOT COALESCE(is_verified, FALSE)
"""

EVENT_SQL = """
    INSERT INTO events (
        schools_involved, location, time, date, attendance,
        is_scraped, external_id, fair_name, created_at, updated_at
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (external_id) DO UPDATE SET
        schools_involved = EXCLUDED.schools_involved,
        location = EXCLUDED.location,
        time = EXCLUDED.time,
        date = EXCLUDED.date,
        attendance = EXCLUDED.attendance,
        is_scraped = EXCLUDED.is_scraped,
        fair_name = EXCLUDED.fair_name,
        updated_at = EXCLUDED.updated_at
    WHERE events.is_scraped IS TRUE
"""

CONTACT_SQL = """
    INSERT INTO contacts (school_id, staff_id) VALUES (%s, %s)
    ON CONFLICT (school_id, staff_id) DO NOTHING
"""


def clean(value):
    if value is None:
        return ""
    text = re.sub(r"\s+", " ", str(value).replace("\u00a0", " ")).strip()
    return "" if text.casefold() in EMPTY_VALUES else text


def contact_text(value):
    value = unescape(clean(value))
    if "<" in value and ">" in value:
        value = BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
    value = re.sub(r"^[\s,;:|\-–—]+|[\s,;:|\-–—]+$", "", value)
    return re.sub(r"\s+", " ", value)


def normalize(value):
    text = unicodedata.normalize("NFKD", clean(value))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"[^a-z0-9]+", " ", text.casefold())
    return re.sub(r"\s+", " ", text).strip()


def digits(value):
    return re.sub(r"\D", "", clean(value))


def school_words(value):
    words = []
    for word in normalize(value).split():
        if word == "campus":
            continue
        words.extend(SHORT_TO_LONG.get(word, word).split())
    return words


def stable_text(*parts, length=20):
    joined = "|".join(normalize(part) for part in parts)
    return sha256(joined.encode("utf-8")).hexdigest()[:length]


def repair_url(value):
    value = clean(value).strip(" <>\"'")
    if not value:
        return ""
    value = re.sub(r"^https?://(?=(?:https?|htt):?/)", "", value, flags=re.I)
    malformed = re.match(r"^(https?|htt):?/{1,2}(.+)$", value, flags=re.I)
    if malformed:
        token, rest = malformed.groups()
        scheme = "https" if token.casefold() == "https" else "http"
        value = f"{scheme}://{rest.lstrip('/')}"
    elif re.match(r"^https?:(?!//)", value, flags=re.I):
        scheme, rest = value.split(":", 1)
        value = f"{scheme.casefold()}://{rest.lstrip('/')}"
    elif value.startswith("//"):
        value = "https:" + value
    elif not re.match(r"^https?://", value, flags=re.I):
        value = "https://" + value
    return value


def canonical_url(value, base="", allow_blocked=False):
    value = clean(value).strip(" <>\"'")
    if not value:
        return ""
    if base and not re.match(r"^(?:https?:)?//", value, flags=re.I):
        try:
            value = urljoin(base, value)
        except ValueError:
            return ""
    value = repair_url(value)
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").casefold().rstrip(".")
        port = parsed.port
    except (TypeError, ValueError):
        return ""
    if parsed.scheme.casefold() not in {"http", "https"} or not host:
        return ""
    if parsed.username or parsed.password or any(character.isspace() for character in host):
        return ""
    if port is not None and not 1 <= port <= 65_535:
        return ""
    try:
        ip_address(host)
        return ""
    except ValueError:
        pass
    labels = host.split(".")
    if len(host) > 100 or len(labels) > 9:
        return ""
    if any(not re.fullmatch(r"[a-z0-9-]{1,63}", label) or label.startswith("-") or label.endswith("-") for label in labels):
        return ""
    if not allow_blocked and any(host == blocked or host.endswith("." + blocked) for blocked in BLOCKED_HOSTS):
        return ""
    netloc = host
    if port is not None and not (
        parsed.scheme.casefold() == "http" and port == 80
        or parsed.scheme.casefold() == "https" and port == 443
    ):
        netloc += f":{port}"
    path = quote(unquote(parsed.path or "/"), safe="/:@-._~!$&'()*+,;=")
    query_items = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.casefold().startswith("utm_") and key.casefold() not in {"fbclid", "gclid"}
    ]
    query = urlencode(query_items, doseq=True)
    return urlunsplit((parsed.scheme.casefold(), netloc, path, query, ""))


def host_of(url):
    try:
        return (urlsplit(url).hostname or "").casefold()
    except ValueError:
        return ""


def organization_domain(url):
    parts = host_of(url).removeprefix("www.").split(".")
    if len(parts) >= 4 and ".".join(parts[-3:]) in {"k12.il.us", "k12.mo.us"}:
        return ".".join(parts[-4:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else ".".join(parts)


def related_sites(left, right):
    left_host = host_of(left)
    right_host = host_of(right)
    if not left_host or not right_host:
        return False
    return (
        left_host == right_host
        or left_host.endswith("." + right_host)
        or right_host.endswith("." + left_host)
        or organization_domain(left) == organization_domain(right)
    )


def normalized_role(title):
    title = clean(title)
    if not title or REJECT_ROLE.search(title):
        return ""
    for role in ROLE_ORDER:
        if ROLE_PATTERNS[role].search(title):
            return role
    return ""


def looks_like_person(value):
    value = clean(value).strip(".,:;|- ")
    if not value or len(value) > 75 or EMAIL.search(value) or PHONE.search(value):
        return False
    if any(character.isdigit() for character in value):
        return False
    words = [word.strip(".,'\"()") for word in value.split() if word.strip(".,'\"()")]
    if not 2 <= len(words) <= 5:
        return False
    normalized = {normalize(word) for word in words}
    if normalized & NAME_NOISE:
        return False
    if normalized_role(value):
        return False
    if not all(re.fullmatch(r"[A-Za-z][A-Za-z'’.-]*", word) for word in words):
        return False
    return sum(word[0].isupper() or word.isupper() for word in words) >= 2


def split_phone(value):
    match = PHONE.search(clean(value))
    if not match:
        return "", ""
    text = match.group(0)
    extension = ""
    extension_match = re.search(r"(?:x|ext\.?|extension)\s*(\d{1,8})", text, re.I)
    if extension_match:
        extension = extension_match.group(1)
    number = digits(text[: extension_match.start()] if extension_match else text)
    if len(number) == 11 and number.startswith("1"):
        number = number[1:]
    if len(number) != 10:
        return "", extension
    return f"{number[:3]}-{number[3:6]}-{number[6:]}", extension


def parse_datetime(value):
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime.combine(value, day_time.min)
    elif isinstance(value, (int, float)):
        seconds = float(value) / 1_000 if float(value) > 10_000_000_000 else float(value)
        try:
            result = datetime.fromtimestamp(seconds, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    else:
        text = clean(value)
        if not text:
            return None
        formats = (
            "%Y%m%dT%H%M%SZ",
            "%Y%m%dT%H%M%S",
            "%Y%m%d",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        )
        result = None
        for pattern in formats:
            try:
                result = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
        if result is None:
            try:
                result = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
    if result.tzinfo is not None:
        result = result.astimezone(timezone.utc).replace(tzinfo=None)
    return result


def iter_json(value, limit=20_000):
    stack = [value]
    visited = 0
    while stack and visited < limit:
        item = stack.pop()
        visited += 1
        if isinstance(item, dict):
            yield item
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)


def json_documents(page):
    documents = []
    if "json" in page.content_type.casefold():
        try:
            documents.append(json.loads(page.text))
        except json.JSONDecodeError:
            pass
    soup = BeautifulSoup(page.text, "html.parser")
    for script in soup.find_all("script")[:300]:
        script_type = clean(script.get("type")).casefold()
        if "json" not in script_type and not script.get("data-schoolreach-captured"):
            continue
        try:
            documents.append(json.loads(script.string or script.get_text() or ""))
        except json.JSONDecodeError:
            continue
    return documents


def json_value(value):
    if is_dataclass(value):
        return {key: json_value(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def write_json(file_path, value):
    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = file_path.with_name(f"{file_path.name}.{os.getpid()}.temporary")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(json_value(value), handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(temporary, file_path)


def read_json(file_path, default=None):
    try:
        with Path(file_path).open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def make_record(record_class, data):
    allowed = {item.name for item in fields(record_class)}
    values = {key: value for key, value in data.items() if key in allowed}
    return record_class(**values)


def serves_high_school(name, grades, low_grade="", high_grade=""):
    school_name = normalize(name)
    if "junior high" in school_name and not any(word in school_name for word in ("senior", "jr sr")):
        return False
    combined = normalize(" ".join([grades, low_grade, high_grade]))
    numbers = [int(number) for number in re.findall(r"\b\d{1,2}\b", combined)]
    if any(10 <= number <= 12 for number in numbers):
        return True
    if 9 in numbers and any(term in school_name for term in ("high school", "secondary", "academy")):
        return True
    return any(term in school_name for term in ("high school", "senior high", "secondary school"))


def unique_school_id(state, supplied, name, city):
    supplied = clean(supplied)
    if supplied and supplied.casefold() not in {"pending", "(pending)", "unknown"}:
        return f"{state}:{supplied}"
    return f"{state}:generated:{stable_text(name, city, length=16)}"


def attach_district_context(schools):
    groups = defaultdict(list)
    for school in schools:
        district_key = f"{school.state}:{school.district_code or normalize(school.district_name)}"
        groups[district_key].append(school)
    for members in groups.values():
        names = [school.name for school in members]
        roots = []
        for school in members:
            for value in (school.district_website, school.website):
                url = canonical_url(value)
                if url and url not in roots:
                    roots.append(url)
        for school in members:
            school.peer_names = tuple(name for name in names if normalize(name) != normalize(school.name))
            school.alternate_seeds = tuple(url for url in roots if url not in {school.website, school.district_website})
    return schools


def header_key(value):
    return re.sub(r"[^a-z0-9]", "", normalize(value))


def first_value(row, *names):
    normalized = {header_key(key): value for key, value in row.items()}
    for name in names:
        value = normalized.get(header_key(name))
        if clean(value):
            return clean(value)
    return ""


def code(value, width=0, letters=False):
    value = clean(value)
    if not value:
        return ""
    if letters:
        value = re.sub(r"[^A-Za-z0-9]", "", value)
    else:
        value = digits(value)
    return value.zfill(width) if width else value


def integer(value):
    text = digits(value)
    return int(text) if text else None


def county_name(result):
    county = clean(result.school.county)
    return county or "Unknown"


def school_result_from_dict(data):
    from models import Contact, Event, Resolution, School, SchoolResult

    return SchoolResult(
        school=make_record(School, data.get("school", {})),
        resolution=make_record(Resolution, data.get("resolution", {})),
        contacts=[make_record(Contact, item) for item in data.get("contacts", [])],
        events=[make_record(Event, item) for item in data.get("events", [])],
        contact_pages=list(data.get("contact_pages", [])),
        calendar_pages=list(data.get("calendar_pages", [])),
        error=clean(data.get("error")),
    )
