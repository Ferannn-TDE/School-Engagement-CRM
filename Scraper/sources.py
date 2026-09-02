from pathlib import Path

import requests

from helpers import (
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
        response = self.session.get(ISBE_DIRECTORY_URL, timeout=90, allow_redirects=True)
        response.raise_for_status()
        content = response.content

        if not content.startswith(b"\xd0\xcf\x11\xe0"):
            raise RuntimeError("ISBE did not return its expected .xls directory file.")

        raw_folder = Path(raw_folder)
        raw_folder.mkdir(parents=True, exist_ok=True)
        raw_path = raw_folder / "illinois_directory.xls"
        raw_path.write_bytes(content)
        return self.from_workbook(content)

    def from_workbook(self, content):
        import xlrd

        workbook = xlrd.open_workbook(file_contents=content)
        rows = []

        for sheet in workbook.sheets():
            if "public" not in sheet.name.casefold():
                continue
            header_index = self.header_row(sheet)
            headers = [clean(value) for value in sheet.row_values(header_index)]

            for row_index in range(header_index + 1, sheet.nrows):
                values = sheet.row_values(row_index)
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
    def header_row(sheet):
        for index in range(min(12, sheet.nrows)):
            headings = {header_key(value) for value in sheet.row_values(index)}
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
                data_source=ISBE_DIRECTORY_URL,
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


class StateRoster:
    def __init__(self, sources=None):
        self.sources = list(sources or (IllinoisSource(), MissouriSource()))

    def load(self, raw_folder):
        raw_folder = Path(raw_folder)
        schools = [school for source in self.sources for school in source.download(raw_folder)]
        keys = [school.facility_key for school in schools]

        if len(keys) != len(set(keys)):
            raise RuntimeError("The official roster produced duplicate facility keys.")

        write_json(raw_folder / "normalized_schools.json", schools)
        return schools
