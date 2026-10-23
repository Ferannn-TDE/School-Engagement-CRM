import re
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

from helpers import (
    ISBE_DIRECTORY_PAGE_URL,
    ISBE_DIRECTORY_URL,
    MISSOURI_DISTRICTS_URL,
    MISSOURI_SCHOOLS_URL,
    USER_AGENT,
    attach_district_context,
    canonical_url,
    clean,
    code,
    digits,
    first_value,
    header_key,
    integer,
    normalize,
    serves_high_school,
    unique_school_id,
    write_json,
)
from models import School


class OfficialSchoolSource:
    state = ""

    def __init__(self, session=None):
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    def download(self, raw_folder):
        raise NotImplementedError


class IllinoisSource(OfficialSchoolSource):
    state = "IL"

    def download(self, raw_folder):
        content = b""
        directory_url = ""

        for url in self.directory_urls():
            try:
                response = self.session.get(url, timeout=90, allow_redirects=True)
                response.raise_for_status()
            except requests.RequestException:
                continue

            if response.content.startswith((b"PK\x03\x04", b"\xd0\xcf\x11\xe0")):
                content = response.content
                directory_url = response.url
                break

        if not content:
            raise RuntimeError("ISBE did not return a valid .xlsx or .xls directory file.")

        raw_folder = Path(raw_folder)
        raw_folder.mkdir(parents=True, exist_ok=True)
        suffix = ".xlsx" if content.startswith(b"PK\x03\x04") else ".xls"
        raw_path = raw_folder / f"illinois_directory{suffix}"
        raw_path.write_bytes(content)
        self.directory_url = directory_url
        return self.from_workbook(content)

    def directory_urls(self):
        urls = []

        try:
            response = self.session.get(
                ISBE_DIRECTORY_PAGE_URL,
                timeout=90,
                allow_redirects=True,
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                normalized = href.casefold()
                if ".xls" not in normalized:
                    continue
                if "dir_ed" not in normalized and "directory-ed-entities" not in normalized:
                    continue
                urls.append(urljoin(response.url, href))
        except requests.RequestException:
            pass

        urls.append(ISBE_DIRECTORY_URL)
        return list(dict.fromkeys(urls))

    def from_workbook(self, content):
        if content.startswith(b"PK\x03\x04"):
            import openpyxl

            workbook = openpyxl.load_workbook(
                BytesIO(content),
                read_only=True,
                data_only=True,
            )
            sheets = [
                (sheet.title, list(sheet.values))
                for sheet in workbook.worksheets
            ]
            workbook.close()
        else:
            import xlrd

            workbook = xlrd.open_workbook(file_contents=content)
            sheets = [
                (
                    sheet.name,
                    [sheet.row_values(index) for index in range(sheet.nrows)],
                )
                for sheet in workbook.sheets()
            ]

        rows = []

        for sheet_name, sheet_rows in sheets:
            if "public" not in sheet_name.casefold():
                continue
            header_index = self.header_row(sheet_rows)
            headers = [clean(value) for value in sheet_rows[header_index]]

            for values in sheet_rows[header_index + 1:]:
                row = {
                    header: self.cell(value)
                    for header, value in zip(headers, values)
                    if header
                }
                if any(clean(value) for value in row.values()):
                    rows.append(row)

        if not rows:
            raise RuntimeError("No public-school rows were found in the ISBE workbook.")
        return self.from_rows(rows)

    @staticmethod
    def header_row(rows):
        for index, row in enumerate(rows[:12]):
            headings = {header_key(value) for value in row}
            if "facilityname" in headings and ("school" in headings or "website" in headings):
                return index
        return 0

    @staticmethod
    def cell(value):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return value

    def from_rows(self, rows):
        rows = list(rows)
        districts = {}

        for row in rows:
            district_code = code(
                first_value(
                    row,
                    "Region-2 County-3 District-4",
                    "Region-2\nCounty-3\nDistrict-4",
                    "RCDT",
                    "District Code",
                ),
                9,
            )
            school_code = code(first_value(row, "School", "School Code"), 4, letters=True)
            if district_code and school_code == "0000":
                districts[district_code] = {
                    "name": first_value(row, "FacilityName", "District Name", "Entity Name"),
                    "website": canonical_url(first_value(row, "Website", "Web Site", "URL", "Homepage")),
                }

        schools = []
        seen = set()

        for row in rows:
            name = first_value(row, "FacilityName", "School Name", "Entity Name", "Name")
            district_code = code(
                first_value(
                    row,
                    "Region-2 County-3 District-4",
                    "Region-2\nCounty-3\nDistrict-4",
                    "RCDT",
                    "District Code",
                ),
                9,
            )
            school_code = code(first_value(row, "School", "School Code"), 4, letters=True)
            entity_type = first_value(row, "Type", "Entity Type Code")
            record_type = normalize(first_value(row, "RecType", "Record Type"))
            grades = first_value(row, "GradeServed", "Grades Served", "Grades", "Grade Span")

            if not name or school_code == "0000" or record_type in {"dist", "district"}:
                continue
            if not serves_high_school(name, grades):
                continue

            rcdts = first_value(row, "RCDTS", "RCDTS Code", "School RCDTS")
            if not rcdts and district_code and entity_type and school_code:
                rcdts = district_code + code(entity_type, 2) + school_code

            city = first_value(row, "City", "Physical City", "Mailing City")
            facility_key = unique_school_id(
                "IL",
                rcdts or first_value(row, "NCES_ID", "NCES ID"),
                name,
                city,
            )
            if facility_key in seen:
                continue
            seen.add(facility_key)

            district = districts.get(district_code, {})
            schools.append(School(
                facility_key=facility_key,
                name=name,
                state="IL",
                district_name=first_value(row, "DistrictName", "District Name") or clean(district.get("name")),
                district_code=district_code,
                city=city,
                county=first_value(row, "CountyName", "County", "County Name"),
                address=first_value(row, "DeliveryAddress", "MailingAddress", "Address", "Street Address"),
                zipcode=first_value(row, "Zip", "ZIP", "Zip Code"),
                phone=first_value(row, "Telephone", "Phone", "Phone Number"),
                grades=grades,
                website=canonical_url(first_value(row, "Website", "Web Site", "URL", "Homepage")),
                district_website=clean(district.get("website")),
                administrator=first_value(row, "Administrator", "Administrator Name", "Principal"),
                administrator_title="Administrator",
                directory_email=first_value(row, "Email", "School Email"),
                nces_id=first_value(row, "NCES_ID", "NCES ID", "NCESID"),
                state_id=rcdts,
                data_source=getattr(self, "directory_url", ISBE_DIRECTORY_URL),
            ))

        schools.sort(key=lambda school: (normalize(school.name), normalize(school.city)))
        return attach_district_context(schools)


class MissouriSource(OfficialSchoolSource):
    state = "MO"

    def download(self, raw_folder):
        districts = self.arcgis_rows(
            MISSOURI_DISTRICTS_URL,
            "ESRI_OID,CTYDIST,DNAME,DCOUNTY,URL,DIEMAIL,DPHONE",
            order_by="ESRI_OID",
        )
        schools = self.arcgis_rows(MISSOURI_SCHOOLS_URL, "*")

        raw_folder = Path(raw_folder)
        raw_folder.mkdir(parents=True, exist_ok=True)
        write_json(raw_folder / "missouri_districts.json", districts)
        write_json(raw_folder / "missouri_schools.json", schools)
        return self.from_rows(schools, districts)

    def arcgis_rows(self, layer_url, fields, order_by="OBJECTID"):
        rows = []
        offset = 0

        while True:
            response = self.session.get(
                layer_url.rstrip("/") + "/query",
                params={
                    "where": "1=1",
                    "outFields": fields,
                    "returnGeometry": "false",
                    "orderByFields": order_by,
                    "resultOffset": offset,
                    "resultRecordCount": 1_000,
                    "f": "json",
                },
                timeout=90,
            )
            response.raise_for_status()
            payload = response.json()

            if payload.get("error"):
                message = clean(payload["error"].get("message", payload["error"]))
                raise RuntimeError(f"Missouri ArcGIS query failed: {message}")

            page = [
                feature.get("attributes", {})
                for feature in payload.get("features", [])
                if isinstance(feature, dict)
            ]
            rows.extend(page)

            if len(page) < 1_000:
                return rows
            offset += len(page)

    def from_rows(self, school_rows, district_rows):
        districts = {
            digits(first_value(row, "CTYDIST", "DIST_CODE", "District Code")): row
            for row in district_rows
            if digits(first_value(row, "CTYDIST", "DIST_CODE", "District Code"))
        }

        schools = []
        seen = set()

        for row in school_rows:
            name = first_value(row, "Facility", "School Name", "Name")
            low = first_value(row, "BGrade", "Beginning Grade", "Low Grade")
            high = first_value(row, "EGrade", "Ending Grade", "High Grade")
            grades = "-".join(value for value in (low, high) if value)

            if not name or not serves_high_school(name, grades, low, high):
                continue

            district_code = digits(first_value(row, "CtyDist", "District Number", "DIST_CODE"))
            district = districts.get(district_code, {})
            city = first_value(row, "City", "School City")
            supplied_id = first_value(row, "SchID", "School ID")
            facility_key = unique_school_id("MO", supplied_id, name, city)

            if facility_key in seen:
                continue
            seen.add(facility_key)

            schools.append(School(
                facility_key=facility_key,
                name=name,
                state="MO",
                district_name=first_value(row, "NAME", "District Name") or first_value(district, "DNAME", "DIST_NAME", "District Name"),
                district_code=district_code,
                city=city,
                county=first_value(row, "County", "County Name") or first_value(district, "DCOUNTY", "COUNTY"),
                address=first_value(row, "Address", "School Address"),
                zipcode=first_value(row, "ZIP", "School ZIP Code"),
                phone=first_value(row, "Phone", "School Phone"),
                grades=grades,
                website="",
                district_website=canonical_url(first_value(district, "URL", "District Web Address")),
                administrator=first_value(row, "Principal", "Administrator Name"),
                administrator_title=first_value(row, "PrinTitle", "Administrator Title") or "Principal",
                directory_email=first_value(row, "Email", "School Email"),
                state_id=supplied_id,
                enrollment=integer(first_value(row, "Enrollment", "Total Enrollment")),
                data_source=MISSOURI_SCHOOLS_URL,
            ))

        schools.sort(key=lambda school: (normalize(school.name), normalize(school.city)))
        return attach_district_context(schools)


class MissouriPrivateSource(OfficialSchoolSource):
    state = "MO"
    directory_url = "https://www.mshsaa.org/Schools/SchoolListing.aspx"
    profile_url = "https://www.mshsaa.org/Schools/AccountInfo.aspx?s={}"

    def download(self, raw_folder):
        response = self.session.get(self.directory_url, timeout=60)
        response.raise_for_status()
        candidates = self.profile_ids(response.text)
        folder = Path(raw_folder) / "missouri_private"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "listing.html").write_text(response.text, encoding="utf-8")

        # Each worker owns its session; the directory session is not shared between threads.
        def load_profile(school_id):
            url = self.profile_url.format(school_id)
            with requests.Session() as session:
                session.headers["User-Agent"] = USER_AGENT
                reply = session.get(url, timeout=60)
                reply.raise_for_status()
            (folder / f"{school_id}.html").write_text(reply.text, encoding="utf-8")
            return self.from_profile(reply.text, school_id)

        with ThreadPoolExecutor(max_workers=4) as pool:
            schools = [school for school in pool.map(load_profile, candidates) if school]
        if not schools:
            raise RuntimeError("MSHSAA returned no confirmed Missouri private high schools.")
        keys = [school.facility_key for school in schools]
        if len(keys) != len(set(keys)):
            raise RuntimeError("MSHSAA returned duplicate Missouri private school IDs.")
        schools.sort(key=lambda school: (normalize(school.name), normalize(school.city)))
        write_json(folder / "schools.json", schools)
        return schools

    @staticmethod
    def profile_ids(html):
        soup = BeautifulSoup(html, "html.parser")
        ids = []
        for row in soup.select("tr[data-organizationtype]"):
            if row.get("data-organizationtype") not in {"1", "3"}:
                continue
            if row.get("data-membertype") not in {"member", "affiliate"}:
                continue
            link = row.select_one('a[href*="?s="]')
            if not link:
                raise RuntimeError("MSHSAA school listing is missing a profile link.")
            school_id = parse_qs(urlsplit(link["href"]).query).get("s", [""])[0]
            if not school_id.isdigit():
                raise RuntimeError("MSHSAA school listing has an invalid profile ID.")
            if school_id not in ids:
                ids.append(school_id)
        if not ids:
            raise RuntimeError("MSHSAA school listing could not be read.")
        return ids

    @classmethod
    def from_profile(cls, html, school_id):
        soup = BeautifulSoup(html, "html.parser")
        fields = {}
        for row in soup.select("tr"):
            label, value = row.find("th", recursive=False), row.find("td", recursive=False)
            if label and value:
                fields[clean(label.get_text(" ")).rstrip(":")] = value

        def value(label):
            cell = fields.get(label)
            return clean(cell.get_text(" ")) if cell else ""

        kind = value("School Type").casefold()
        if kind not in {"public", "private", "charter", "public (charter school)"}:
            raise RuntimeError(f"MSHSAA profile {school_id} has no recognized school type.")
        if kind != "private":
            return None
        if "home school" in value("Membership Type").casefold():
            return None
        name, grades = value("School Name"), value("Grades Served")
        if not name or not grades:
            raise RuntimeError(f"MSHSAA private profile {school_id} lacks name or grades.")
        if not serves_high_school(name, grades):
            return None
        location = soup.select_one('[id$="lbl911CityStateZipView"]')
        location = clean(location.get_text(" ")) if location else ""
        match = re.fullmatch(r"(.+),\s*MO\s+(\d{5}(?:-\d{4})?)", location)
        if not match:
            raise RuntimeError(f"MSHSAA private profile {school_id} lacks a Missouri mailing location.")
        city, zipcode = match.groups()
        street = soup.select_one('[id$="lbl911StreetAddressLine1View"]')
        website_cell = fields.get("School Website")
        website_link = website_cell.find("a", href=True) if website_cell else None
        website = canonical_url(website_link["href"]) if website_link else ""
        dese = digits(value("DESE Code"))
        supplied_id = f"{dese[:6]}-{dese[6:]}" if len(dese) == 10 else f"mshsaa-{school_id}"
        profile = cls.profile_url.format(school_id)
        return School(
            facility_key=unique_school_id("MO", supplied_id, name, city),
            name=name, state="MO", city=city, county=value("County").replace(".", ""),
            address=clean(street.get_text(" ")) if street else "", zipcode=zipcode,
            phone=value("Phone"), grades=grades, website=website,
            state_id=supplied_id, data_source=profile,
            alternate_seeds=(profile,) if not website else (),
            school_type="Private high school",
        )


class StateRoster:
    def __init__(self, sources=None):
        self.sources = list(sources or (IllinoisSource(), MissouriSource(), MissouriPrivateSource()))

    def load(self, raw_folder):
        raw_folder = Path(raw_folder)
        schools = [school for source in self.sources for school in source.download(raw_folder)]
        keys = [school.facility_key for school in schools]

        if len(keys) != len(set(keys)):
            raise RuntimeError("The official roster produced duplicate facility keys.")

        write_json(raw_folder / "normalized_schools.json", schools)
        return schools
