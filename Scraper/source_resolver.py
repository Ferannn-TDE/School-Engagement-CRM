import json
import os
from pathlib import Path
import re
from difflib import SequenceMatcher
from urllib.parse import quote, urlsplit

import requests

from helpers import (
    STATE_NAMES,
    USER_AGENT,
    attach_district_context,
    canonical_url,
    clean,
    header_key,
    integer,
    normalize,
    unique_school_id,
    utc_now,
    write_json,
)
from models import School
from source_reader import SourceReader


def serves_high_school(name, grades, low_grade="", high_grade=""):
    school_name = normalize(name)
    if any(term in school_name for term in ("adult", "ged", "community college")):
        return False
    if any(term in school_name for term in ("junior high", "jr high")) and not any(
        term in school_name for term in ("senior", "jr sr", "junior senior")
    ):
        return False
    combined = normalize(" ".join([grades, low_grade, high_grade]))
    numbers = []
    for token in re.findall(r"\d{1,4}", combined):
        number = int(token)
        if len(token) >= 3 and number % 100 == 12:
            number = 12
        elif len(token) == 3 and token.endswith("0") and number <= 120:
            number //= 10
        numbers.append(number)
    if numbers:
        return 12 in numbers
    words = set(school_name.split())
    return bool(
        "high" in words
        or "hs" in words
        or any(term in school_name for term in ("senior high", "secondary school", "jr sr"))
    )


DISPLAY_ACRONYMS = {
    "BACC", "CISD", "CTE", "CUSD", "ELL", "ES", "FM", "GS", "HS", "IEP",
    "ISD", "JH", "JR", "MS", "NE", "NW", "PK", "PO", "SD", "SE", "SEC",
    "SR", "STEM", "STEAM", "SW", "US", "USD",
}

def title_case(value):
    value = clean(value)
    if not value or not (value.isupper() or value.islower()):
        return value

    value = value.title()
    value = re.sub(r"\bMc([a-z])", lambda item: "Mc" + item.group(1).upper(), value)
    for acronym in DISPLAY_ACRONYMS:
        value = re.sub(rf"\b{acronym.title()}\b", acronym, value)
    for prefix in ("Dr", "Mr", "Mrs", "Ms"):
        value = re.sub(rf"\b{prefix}\b\.?", prefix + ".", value)
    return re.sub(r"\b(And|For|Of|The|To)\b", lambda item: item.group(0).lower(), value)


SOURCE_FILE = Path(__file__).with_name("state_sources.json")

FIELD_ALIASES = {
    "name": (
        "School Name", "Facility Name", "Facility", "Institution Name",
        "Entity Name", "Building Name", "Campus Name", "Organization Name",
        "School Site Name", "Site Long Name", "District/School Name", "SCH_NAME",
        "School", "Name",
    ),
    "state_id": (
        "State School ID", "School ID", "School Number", "School Code", "Building Code", "Campus Number",
        "Institution Code", "Organization Code", "RCDTS", "BEDS Code", "CDSCode", "SchID", "SchNum",
    ),
    "nces_id": ("NCES School ID", "NCES ID", "NCESSchool", "NCESSCH", "NCESID"),
    "district_name": (
        "District Name", "School District", "LEA Name", "Agency Name", "System Name", "District", "NAME",
    ),
    "district_code": (
        "District Code", "District ID", "District Number", "LEA ID", "Agency Code", "System Code", "CtyDist",
        "Region County District", "Region-2 County-3 District-4", "RCDT",
    ),
    "address": (
        "School Site Street Address", "School Street Address", "Physical Street", "Physical Address",
        "Street Address", "School Address", "Address 1",
        "Address", "Mailing Address", "Delivery Address", "LSTREET1", "Street",
    ),
    "city": ("Physical City", "School City", "Mailing City", "LCITY", "City"),
    "state": ("Physical State", "School State", "Mailing State", "LSTATE", "State", "State Abbreviation"),
    "county": ("County Name", "School County Name", "County", "NMCNTY"),
    "zipcode": (
        "School Site ZIP", "School ZIP", "Physical ZIP", "School ZIP Code", "ZIP Code",
        "Postal Code", "Mailing ZIP", "LZIP", "ZIP", "Zip",
    ),
    "phone": ("School Phone", "Phone Number", "Telephone", "Phone"),
    "grades": (
        "Grades Served", "Grade Span", "Grade Range", "GradeServed", "Grades", "Level",
        "School Level", "GSserved", "GSoffered",
    ),
    "low_grade": ("Beginning Grade", "Lowest Grade", "Low Grade", "GSLO", "BGrade"),
    "high_grade": ("Ending Grade", "Highest Grade", "High Grade", "GSHI", "EGrade"),
    "website": (
        "School Website", "School Web Page Address", "School Webpage Address",
        "Web Site", "Website", "Homepage", "Web Address", "URL",
    ),
    "district_website": (
        "District Website", "District Web Page Address", "District Webpage Address",
        "LEA Website", "District URL",
    ),
    "administrator": (
        "Administrator Name", "School Administrator", "Principal Name", "Principal", "Administrator",
    ),
    "administrator_title": (
        "Administrator Title", "Principal Title", "Admin Title", "Title", "PrinTitle",
    ),
    "directory_email": (
        "School Email", "Administrator Email", "Principal Email", "Email Address", "Email",
    ),
    "enrollment": (
        "School Enrollment", "Total Enrollment", "Student Enrollment", "Enrollment", "MEMBER", "Students",
    ),
    "status": (
        "Operational Status", "School Status", "Entity Status", "Institution Status",
        "SY_STATUS_TEXT", "Status",
    ),
    "school_type": ("School Type", "Institution Type", "Entity Type", "Sector", "Type"),
}

INACTIVE_WORDS = (
    "closed", "inactive", "future", "merged", "ceased", "not operating", "pending",
)

SCHOOL_FIELDS = {
    "name", "state_id", "nces_id", "address", "city", "state", "zipcode", "phone",
    "grades", "low_grade", "high_grade", "website", "administrator",
    "administrator_title", "directory_email", "enrollment", "status", "school_type",
}
DISTRICT_WORDS = {"district", "lea", "agency", "system"}


class SeedResolver:
    file_types = {".csv", ".tsv", ".json", ".xml", ".xlsx", ".xls", ".zip", ".pdf", ".ics"}

    def __init__(self, settings, source_url):
        self.settings = settings
        self.source_url = source_url

    def resolve(self, row, *known):
        found = []

        def add(value, base=""):
            text = clean(value)
            if not text or "@" in text:
                return
            bare_domain = bool(re.match(r"^[a-z0-9.-]+\.[a-z]{2,}(?:/|$)", text, re.I))
            looks_like_url = bool(
                re.match(r"^(?:https?:)?//", text, re.I)
                or text.casefold().startswith("www.")
                or bare_domain
                or (base and text.startswith("/"))
            )
            if not looks_like_url:
                return
            url = canonical_url(text, "" if bare_domain else base)
            if not url or urlsplit(url).path.casefold().endswith(tuple(self.file_types)):
                return
            if url not in found:
                found.append(url)

        for value in known:
            add(value)

        template = clean(self.settings.get("profile_url", ""))
        if template:
            try:
                add(template.format(**{str(key): source_value(value) for key, value in row.items()}))
            except (KeyError, ValueError):
                pass

        for heading, value in row.items():
            label = normalize(heading)
            if str(heading).startswith("_") or "email" in label:
                continue
            if any(word in label for word in ("download", "data source", "api endpoint")):
                continue
            base = self.source_url if any(
                word in label for word in ("url", "web", "link", "profile")
            ) else ""
            add(value, base)

        return tuple(found)


def source_value(value):
    if isinstance(value, dict):
        value = (
            value.get("url")
            or value.get("href")
            or value.get("value")
            or next((item for item in value.values() if item not in (None, "")), "")
        )
    value = clean(value)
    spreadsheet_text = re.fullmatch(r'=\s*"(.*)"', value)
    if spreadsheet_text:
        value = spreadsheet_text.group(1)
    if value.startswith("'") and " " not in value and any(character.isdigit() for character in value):
        return value[1:]
    return value


def direct_value(row, heading):
    wanted = header_key(heading)
    for key, value in row.items():
        if header_key(key) == wanted:
            return source_value(value)
    return ""


def address_parts(value):
    parts = [clean(part) for part in clean(value).split(",") if clean(part)]
    if len(parts) >= 4 and re.fullmatch(r"\d{5}(?:-\d{4})?", parts[-1]):
        return ", ".join(parts[:-3]), parts[-3], parts[-2], parts[-1]
    if len(parts) >= 3:
        state_zip = re.fullmatch(r"([A-Za-z .]+)\s+(\d{5}(?:-\d{4})?)", parts[-1])
        if state_zip:
            return ", ".join(parts[:-2]), parts[-2], clean(state_zip.group(1)), state_zip.group(2)
    return clean(value), "", "", ""


class ColumnResolver:
    def __init__(self, rows, settings):
        self.settings = settings
        self.headers = []
        self.columns = {}

        step = max(1, len(rows) // 100)
        sample = rows[:100] + rows[100::step][:100]
        for row in sample:
            for heading in row:
                if not str(heading).startswith("_") and heading not in self.headers:
                    self.headers.append(heading)

    def find(self, field):
        if field in self.columns:
            return self.columns[field]

        configured = self.settings.get("columns", {}).get(field, ())
        if isinstance(configured, str):
            configured = (configured,)
        for wanted in configured:
            for heading in self.headers:
                if header_key(heading) == header_key(wanted):
                    self.columns[field] = heading
                    return heading
        aliases = tuple(configured) + FIELD_ALIASES.get(field, ())
        header = self.best_header(field, aliases)
        self.columns[field] = header
        return header

    def best_header(self, field, aliases):
        best = ""
        best_score = 0

        for alias_number, alias in enumerate(aliases):
            alias_name = header_key(alias)
            if not alias_name:
                continue

            for heading in self.headers:
                heading_name = header_key(heading)
                if self.blocked(field, heading):
                    continue

                score = 0
                if heading_name == alias_name:
                    score = 1000 - alias_number
                elif len(alias_name) >= 5 and alias_name in heading_name:
                    score = 700 - abs(len(heading_name) - len(alias_name)) - alias_number

                if score > best_score:
                    best = heading
                    best_score = score

        return best

    @staticmethod
    def blocked(field, heading):
        words = set(normalize(heading).split())
        if field in SCHOOL_FIELDS and words & DISTRICT_WORDS:
            if field == "name" and "school" in words:
                return False
            return True
        if field == "name" and "county" in words:
            return True
        if field == "state" and words & {"license", "licensed", "other"}:
            return True
        if field == "address" and words & {"email", "web", "website", "url"}:
            return True
        return False

    def value(self, row, field):
        headings = self.settings.get("join_columns", {}).get(field, ())
        if isinstance(headings, str):
            headings = (headings,)
        joined = " ".join(direct_value(row, heading) for heading in headings).strip()
        heading = self.find(field)
        value = joined or (source_value(row.get(heading, "")) if heading else "")

        rule = self.settings.get("extract", {}).get(field, "")
        if isinstance(rule, str):
            rule = {"regex": rule}
        pattern = clean(rule.get("regex", "")) if rule else ""
        if pattern and value:
            match = re.search(pattern, value, re.I)
            if match:
                group = int(rule.get("group", 1 if match.lastindex else 0))
                value = clean(match.group(group))
        return value


class RainbowSource:
    def __init__(self, state, settings, session=None, cache=None):
        self.state = state
        self.settings = settings
        aliases = [alias for values in FIELD_ALIASES.values() for alias in values]
        for configured_values in settings.get("columns", {}).values():
            if isinstance(configured_values, str):
                aliases.append(configured_values)
            else:
                aliases.extend(configured_values)
        configured = settings.get("columns", {}).get("name", ())
        if isinstance(configured, str):
            configured = (configured,)
        self.reader = SourceReader(
            settings,
            session,
            cache,
            aliases,
            tuple(configured) + FIELD_ALIASES["name"],
        )

    def load(self):
        rows = self.reader.rows()
        source_url = self.reader.final_url
        lookup = self.lookup_rows(rows)
        schools = self.school_rows(rows, lookup, source_url)

        minimum = int(self.settings.get("minimum_rows", 1))
        if len(schools) < minimum:
            raise RuntimeError(f"Only {len(schools)} grade-12 schools were resolved; expected {minimum}.")

        return schools

    def lookup_rows(self, source_rows):
        settings = self.settings.get("lookup")
        if not settings:
            return {}

        rows = source_rows if settings.get("same_source") else self.reader.rows(settings)
        lookup_key = settings.get("lookup_key", "")
        columns = settings.get("columns", {})
        required = settings.get("match", {})
        values = {}

        for row in rows:
            if any(direct_value(row, heading) != clean(value) for heading, value in required.items()):
                continue
            key = direct_value(row, lookup_key)
            if key:
                values[key] = {
                    field: direct_value(row, heading)
                    for field, heading in columns.items()
                }
        return values

    def school_rows(self, rows, lookup, source_url):
        if not rows:
            raise RuntimeError("The source contained no rows.")

        columns = ColumnResolver(rows, self.settings)
        if not columns.find("name"):
            raise RuntimeError("A school-name column could not be identified.")

        schools = []
        seen = set()
        seed_resolver = SeedResolver(self.settings, source_url)
        for row in rows:
            if self.excluded(row):
                continue

            name = title_case(columns.value(row, "name"))
            if not name or self.inactive(columns.value(row, "status")):
                continue

            row_state = normalize(columns.value(row, "state"))
            state_name = normalize(STATE_NAMES.get(self.state, ""))
            if row_state and row_state not in {normalize(self.state), state_name}:
                continue

            grades = columns.value(row, "grades")
            low_grade = columns.value(row, "low_grade")
            high_grade = columns.value(row, "high_grade")
            served_grades = []
            for heading in self.settings.get("grade_columns", ()):
                try:
                    present = float(direct_value(row, heading).replace(",", "")) > 0
                except (AttributeError, TypeError, ValueError):
                    present = False
                if present:
                    served_grades.append(clean(heading))
            if served_grades:
                low_grade = low_grade or served_grades[0]
                high_grade = high_grade or served_grades[-1]
            grade_12_column = clean(self.settings.get("grade_12_column", ""))
            if self.settings.get("high_school_only"):
                has_grade_12 = True
            elif grade_12_column:
                try:
                    has_grade_12 = float(direct_value(row, grade_12_column).replace(",", "")) > 0
                except (AttributeError, TypeError, ValueError):
                    has_grade_12 = False
            else:
                has_grade_12 = serves_high_school(name, grades, low_grade, high_grade)
            if not has_grade_12:
                continue

            district_code = columns.value(row, "district_code")
            state_id = self.composite_id(row, columns)
            nces_id = columns.value(row, "nces_id")
            city = title_case(columns.value(row, "city"))
            address = title_case(columns.value(row, "address"))
            zipcode = columns.value(row, "zipcode")
            if self.settings.get("split_address"):
                street, parsed_city, _parsed_state, parsed_zipcode = address_parts(address)
                address = title_case(street)
                city = city or title_case(parsed_city)
                zipcode = zipcode or parsed_zipcode
            facility_key = unique_school_id(self.state, state_id or nces_id, name, city)
            if facility_key in seen:
                continue
            seen.add(facility_key)

            lookup_settings = self.settings.get("lookup", {})
            lookup_key = direct_value(row, lookup_settings.get("source_key", ""))
            extra = lookup.get(lookup_key, {})
            grade_range = "-".join(value for value in (low_grade, high_grade) if value)
            website = canonical_url(columns.value(row, "website"))
            district_website = canonical_url(
                columns.value(row, "district_website") or extra.get("district_website", "")
            )
            seeds = seed_resolver.resolve(row, website, district_website)
            schools.append(School(
                facility_key=facility_key,
                name=name,
                state=self.state,
                school_type=self.school_type(row, columns),
                district_name=title_case(
                    columns.value(row, "district_name") or extra.get("district_name", "")
                ),
                district_code=district_code,
                city=city,
                county=title_case(columns.value(row, "county")),
                address=address,
                zipcode=zipcode,
                phone=columns.value(row, "phone"),
                grades=grade_range or grades,
                website=website,
                district_website=district_website,
                administrator=title_case(columns.value(row, "administrator")),
                administrator_title=columns.value(row, "administrator_title") or "Administrator",
                directory_email=columns.value(row, "directory_email"),
                nces_id=nces_id,
                state_id=state_id,
                enrollment=integer(columns.value(row, "enrollment")),
                data_source=source_url,
                alternate_seeds=tuple(
                    seed for seed in seeds if seed not in {website, district_website}
                ),
            ))

        schools.sort(key=lambda school: (normalize(school.name), normalize(school.city)))
        return attach_district_context(schools)

    def composite_id(self, row, columns):
        headings = self.settings.get("id_columns", ())
        parts = [direct_value(row, heading) for heading in headings]
        widths = self.settings.get("id_widths", ())
        if widths:
            parts = [part.zfill(int(width)) if part else "" for part, width in zip(parts, widths)]
        parts = [part for part in parts if part]
        if parts:
            return self.settings.get("id_separator", "-").join(parts)

        return columns.value(row, "state_id")

    def school_type(self, row, columns):
        sector = normalize(self.settings.get("sector", "mixed"))
        private_column = clean(self.settings.get("private_column", ""))
        private_value = normalize(direct_value(row, private_column))
        private_values = {normalize(value) for value in self.settings.get("private_values", ())}
        description = " ".join((
            normalize(row.get("_sheet", "")),
            normalize(columns.value(row, "school_type")),
        ))
        if (
            sector == "private"
            or private_value in private_values
            or any(word in description for word in ("private", "nonpublic", "non pub"))
        ):
            return "Private high school"
        return "Public high school"

    def excluded(self, row):
        for rule in self.settings.get("include_rows", ()):
            raw_value = direct_value(row, rule.get("column", ""))
            value = normalize(raw_value)
            allowed = {normalize(item) for item in rule.get("values", ())}
            if allowed and value not in allowed:
                return True
            terms = [normalize(item) for item in rule.get("contains", ())]
            if terms and not any(term in value for term in terms):
                return True
            pattern = clean(rule.get("regex", ""))
            if pattern and not re.search(pattern, raw_value, re.I):
                return True

        for rule in self.settings.get("positive_rows", ()):
            value = direct_value(row, rule.get("column", ""))
            try:
                if float(value.replace(",", "")) <= 0:
                    return True
            except (AttributeError, TypeError, ValueError):
                return True

        for rule in self.settings.get("exclude_rows", ()):
            raw_value = direct_value(row, rule.get("column", ""))
            value = normalize(raw_value)
            blocked = {normalize(item) for item in rule.get("values", ())}
            pattern = clean(rule.get("regex", ""))
            if value in blocked or (pattern and re.search(pattern, raw_value, re.I)):
                sheet = normalize(row.get("_sheet", ""))
                exceptions = [normalize(item) for item in rule.get("unless_sheet_contains", ())]
                if any(item in sheet for item in exceptions):
                    continue
                return True
        return False

    @staticmethod
    def inactive(status):
        status = normalize(status)
        return bool(status and any(word in status for word in INACTIVE_WORDS))


class SchoolSeedLookup:
    """Attach a usable school URL without replacing the state's roster data."""

    def __init__(self, state, settings, session, cache):
        self.state = state
        self.settings = dict(settings)
        parameters = dict(self.settings.get("params", {}))
        parameters[clean(self.settings.get("state_parameter", "state"))] = state
        self.settings["params"] = parameters
        self.reader = SourceReader(self.settings, session, cache)

    @staticmethod
    def key(value):
        return normalize(value).replace("saint", "st")

    def load(self):
        rows = self.reader.rows()
        columns = self.settings.get("columns", {})
        name_column = columns.get("name", "name")
        city_column = columns.get("city", "city")
        by_name = {}
        by_city = {}
        for row in rows:
            name = self.key(direct_value(row, name_column))
            city = self.key(direct_value(row, city_column))
            if not name:
                continue
            by_name.setdefault(name, []).append(row)
            if city:
                by_city.setdefault(city, []).append(row)
        return by_name, by_city

    def match(self, school, by_name, by_city):
        name = self.key(school.name)
        city = self.key(school.city)
        choices = by_name.get(name, ())
        if len(choices) == 1:
            return choices[0]
        if choices and city:
            for row in choices:
                row_city = self.key(direct_value(row, self.settings["columns"].get("city", "city")))
                if row_city == city:
                    return row

        best = None
        best_score = 0.0
        for row in by_city.get(city, ()) if city else ():
            row_name = self.key(direct_value(row, self.settings["columns"].get("name", "name")))
            score = SequenceMatcher(None, name, row_name).ratio()
            if score > best_score:
                best = row
                best_score = score
        return best if best_score >= 0.88 else None

    def profile(self, row):
        template = clean(self.settings.get("profile_url", ""))
        if not template or not row:
            return ""
        try:
            return canonical_url(template.format(**{
                str(key): source_value(value) for key, value in row.items()
            }), allow_blocked=True)
        except (KeyError, ValueError):
            return ""

    def query(self, school):
        template = clean(self.settings.get("query_url", ""))
        if not template:
            return ""
        return canonical_url(template.format(
            state=quote(self.state, safe=""),
            name=quote(school.name, safe=""),
            city=quote(school.city, safe=""),
        ), allow_blocked=True)

    def apply(self, schools):
        self.success = True
        try:
            by_name, by_city = self.load()
        except Exception:
            self.success = False
            by_name, by_city = {}, {}
        columns = self.settings.get("columns", {})
        website_column = columns.get("website", "website")
        matched = 0
        for school in schools:
            row = self.match(school, by_name, by_city)
            if row:
                matched += 1
            website = canonical_url(direct_value(row, website_column)) if row else ""
            if not school.website and website:
                school.website = website
            seeds = [*school.alternate_seeds, self.profile(row), self.query(school)]
            school.alternate_seeds = tuple(dict.fromkeys(
                seed for seed in seeds
                if seed and seed not in {school.website, school.district_website}
            ))
        return matched


class StateSourceResolver:
    def __init__(self, path=None, data=None, session=None, states=None):
        self.path = Path(path or SOURCE_FILE)
        self.data = data if data is not None else json.loads(self.path.read_text(encoding="utf-8-sig"))
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.cache = {}
        self.states = self.selected_states(states)

    def selected_states(self, states=None):
        configured = self.data.get("states", {})
        if states is None:
            chosen = os.environ.get("SCHOOL_STATES", "")
            states = chosen.split(",") if chosen else [
                state for state, settings in configured.items() if settings.get("enabled", False)
            ]

        selected = []
        for value in states:
            state = clean(value).upper()
            if not state or state in selected:
                continue
            if state not in configured:
                raise ValueError(f"No sources are listed for {state}.")
            selected.append(state)
        if not selected:
            raise ValueError("Enable at least one state in state_sources.json.")
        return selected

    def source_groups(self, state, settings):
        groups = {}
        for source in settings.get("sources", ()):
            if not source.get("enabled", True):
                continue
            source = dict(source)
            used_templates = set()
            template = clean(source.get("template", ""))
            while template and template not in used_templates:
                used_templates.add(template)
                merged = dict(self.data.get(template, {}))
                merged.update(source)
                source = merged
                template = clean(self.data.get(template, {}).get("template", ""))
            state_parameter = clean(source.get("state_parameter", ""))
            if state_parameter:
                parameters = dict(source.get("params", {}))
                parameters[state_parameter] = state
                source["params"] = parameters
            group = source.get("group", source.get("sector", source.get("id", "schools")))
            groups.setdefault(group, []).append(source)
        for sources in groups.values():
            sources.sort(key=lambda source: source.get("priority", 100))
        return groups

    @staticmethod
    def private_remainder(candidates, public_schools):
        """Keep directory schools that are not already in the public roster."""
        public_names = {}
        for school in public_schools:
            name = normalize(school.name)
            if name:
                public_names.setdefault(name, set()).add(normalize(school.city))

        remainder = []
        for school in candidates:
            name = normalize(school.name)
            cities = public_names.get(name)
            city = normalize(school.city)
            if cities is None:
                remainder.append(school)
                continue
            if city and cities and "" not in cities and city not in cities:
                remainder.append(school)
        return remainder

    def load(self, raw_folder):
        raw_folder = Path(raw_folder)
        raw_folder.mkdir(parents=True, exist_ok=True)
        health = {}
        collected = []
        failed_states = []
        failure_details = {}

        for state in self.states:
            health[state] = {}
            state_rows = []
            state_failed = False
            groups = self.source_groups(state, self.data["states"][state])
            if not groups:
                failed_states.append(state)
                failure_details[state] = [f"{state} has no enabled sources."]
                print(f"{state} source failed", flush=True)
                continue

            ordered_groups = sorted(
                groups.items(),
                key=lambda item: 0 if normalize(item[0]) == "public" else 1,
            )
            for group, sources in ordered_groups:
                loaded = None
                errors = []
                for settings in sources:
                    source_id = settings["id"]
                    checked_at = utc_now()
                    try:
                        candidate = RainbowSource(
                            state,
                            settings,
                            session=self.session,
                            cache=self.cache,
                        ).load()
                        public_schools = [
                            school for school in state_rows
                            if school.school_type.startswith("Public")
                        ]
                        private_group = normalize(group).startswith("private")
                        if settings.get("derive_private_from_public") and not public_schools:
                            raise RuntimeError(
                                "A public roster is required to derive private schools."
                            )
                        if private_group and public_schools:
                            candidate = self.private_remainder(candidate, public_schools)
                            if not candidate:
                                raise RuntimeError(
                                    "No private schools remained after removing the public roster."
                                )
                        health[state][source_id] = {
                            "success": True,
                            "checked_at": checked_at,
                        }
                        if loaded is None or len(candidate) > len(loaded):
                            loaded = candidate
                    except Exception as error:
                        health[state][source_id] = {
                            "success": False,
                            "checked_at": checked_at,
                        }
                        detail = clean(str(error))
                        if len(detail) > 300:
                            detail = detail[:297] + "..."
                        message = f"{source_id}: {detail}"
                        errors.append(message)

                if loaded is None:
                    state_failed = True
                    failure_details.setdefault(state, []).append(
                        f"Every source failed for {state}.{group}: {'; '.join(errors)}"
                    )
                    continue
                state_rows.extend(loaded)

            if state_failed:
                failed_states.append(state)
                print(f"{state} source failed", flush=True)
                continue

            unique_rows = {}
            for school in state_rows:
                unique_rows.setdefault(school.facility_key, school)
            seed_settings = self.data.get("seed_lookup", {})
            if seed_settings:
                checked_at = utc_now()
                try:
                    lookup = SchoolSeedLookup(
                        state,
                        seed_settings,
                        self.session,
                        self.cache,
                    )
                    lookup.apply(unique_rows.values())
                    health[state]["seed_lookup"] = {
                        "success": lookup.success,
                        "checked_at": checked_at,
                    }
                except Exception:
                    health[state]["seed_lookup"] = {
                        "success": False,
                        "checked_at": checked_at,
                    }
            collected.extend(unique_rows.values())
            print(f"{state} {len(unique_rows)} schools added", flush=True)

        write_json(raw_folder / "source_health.json", health)
        if failed_states:
            if len(self.states) == 1:
                raise RuntimeError("; ".join(failure_details[failed_states[0]]))
            states = ", ".join(failed_states)
            raise RuntimeError(f"Sources failed for {len(failed_states)} states: {states}")

        schools = {}
        for school in collected:
            schools.setdefault(school.facility_key, school)
        result = list(schools.values())
        result.sort(key=lambda school: (school.state, normalize(school.name), normalize(school.city)))

        write_json(raw_folder / "normalized_schools.json", result)
        return result
