from datetime import datetime
import json

from helpers import (
    EVENT_SQL,
    STAFF_FIND_EMAIL_SQL,
    STAFF_FIND_NAME_SQL,
    STAFF_FIND_PHONE_SQL,
    STAFF_SQL,
    STAFF_UPDATE_SQL,
    STATE_NAMES,
    county_name,
    normalize,
    stable_text,
    utc_now,
)


class DatabaseRows:
    def __init__(self, results, external_events=()):
        self.results = list(results)
        self.external_events = list(external_events)
        self.now = utc_now()

    @staticmethod
    def district_key(result):
        school = result.school
        return (
            school.state,
            school.district_code or normalize(school.district_name) or school.facility_key,
        )

    @staticmethod
    def contact_key(result, contact):
        identity = contact.email or contact.phone or normalize(contact.name)
        return (
            result.school.facility_key,
            normalize(contact.name),
            normalize(identity),
            contact.role,
        )

    def states(self):
        return sorted({
            (result.school.state, STATE_NAMES.get(result.school.state, result.school.state))
            for result in self.results
        })

    def counties(self):
        return sorted({
            (county_name(result), result.school.state)
            for result in self.results
        })

    def districts(self):
        rows = {}
        for result in self.results:
            key = self.district_key(result)
            rows[key] = (
                result.school.district_name or "Unknown district",
                county_name(result),
                result.school.state,
            )
        return [(key, rows[key]) for key in sorted(rows)]

    def schools(self, district_ids):
        rows = []
        for result in self.results:
            school = result.school
            resolution = result.resolution
            notes = json.dumps({
                "state_id": school.state_id,
                "nces_id": school.nces_id,
                "resolution_status": resolution.status,
                "resolution_method": resolution.method,
                "fallback_url": resolution.fallback_url,
                "resolution_reason": resolution.reason,
            }, ensure_ascii=False)

            rows.append((
                school.facility_key,
                school.name,
                district_ids[self.district_key(result)],
                school.phone or None,
                school.address or None,
                "Public high school",
                school.administrator or None,
                school.city or None,
                school.zipcode or None,
                school.grades or None,
                resolution.resolved_url or None,
                county_name(result),
                True,
                True,
                notes,
                self.now,
                self.now,
                school.enrollment,
                school.grades or None,
                school.data_source,
                True,
                self.now,
                "website_verified" if resolution.resolved else "official_roster_only",
                school.state,
            ))
        return rows

    @staticmethod
    def contact_phone(contact):
        phone = contact.phone or ""
        if phone and contact.extension:
            phone = f"{phone} ext. {contact.extension}"
        return phone or None

    def staff(self):
        rows = {}
        for result in self.results:
            for contact in result.contacts:
                key = self.contact_key(result, contact)
                notes = json.dumps({"score": round(float(contact.score), 2)})
                rows[key] = (
                    contact.name,
                    self.contact_phone(contact),
                    contact.email or None,
                    contact.title,
                    result.school.facility_key,
                    True,
                    True,
                    notes,
                    self.now,
                    self.now,
                    contact.method,
                    False,
                    None,
                )
        return [(key, rows[key]) for key in sorted(rows)]

    def contacts(self, staff_ids):
        rows = set()
        for result in self.results:
            for contact in result.contacts:
                key = self.contact_key(result, contact)
                if key in staff_ids:
                    rows.add((result.school.facility_key, staff_ids[key]))
        return sorted(rows)

    def events(self):
        rows = {}
        for result in self.results:
            for event in result.events:
                try:
                    start = datetime.fromisoformat(event.start)
                except ValueError:
                    continue

                external_id = "schoolreach:" + stable_text(
                    result.school.facility_key,
                    event.title,
                    event.start[:16],
                    length=32,
                )
                rows[external_id] = (
                    result.school.facility_key,
                    event.location or None,
                    start.time().replace(microsecond=0),
                    start.date(),
                    None,
                    True,
                    external_id,
                    event.title,
                    self.now,
                    self.now,
                )

        for event in self.external_events:
            try:
                start = datetime.fromisoformat(event.start)
            except ValueError:
                continue

            external_id = "iacac:" + stable_text(
                event.source_url,
                event.title,
                event.start[:16],
                length=32,
            )
            rows[external_id] = (
                None,
                event.location or None,
                start.time().replace(microsecond=0),
                start.date(),
                None,
                True,
                external_id,
                event.title,
                self.now,
                self.now,
            )
        return [rows[key] for key in sorted(rows)]


class DatabaseWriter:
    def __init__(self, database_url, connect=None):
        if not database_url:
            raise ValueError("DATABASE_URL is required when database upload is enabled.")
        self.database_url = database_url
        self.connect = connect

    def connection(self):
        if self.connect is not None:
            return self.connect(self.database_url)

        import psycopg
        return psycopg.connect(self.database_url)

    def find_staff(self, cursor, values):
        name, phone, email, title, school_key = values[:5]
        if email:
            cursor.execute(STAFF_FIND_EMAIL_SQL, (school_key, name, email))
            row = cursor.fetchone()
            if row:
                return row[0]
        if phone:
            cursor.execute(STAFF_FIND_PHONE_SQL, (school_key, name, phone))
            row = cursor.fetchone()
            if row:
                return row[0]
        cursor.execute(STAFF_FIND_NAME_SQL, (school_key, name, title))
        row = cursor.fetchone()
        return row[0] if row else None

    def upsert_staff(self, cursor, records):
        for _, values in records:
            staff_id = self.find_staff(cursor, values)
            if staff_id is None:
                cursor.execute(STAFF_SQL, values)
                cursor.fetchone()
                continue

            name, phone, email, title, school_key = values[:5]
            is_active = values[6]
            notes = values[7]
            updated_at = values[9]
            data_source = values[10]
            cursor.execute(
                STAFF_UPDATE_SQL,
                (
                    name,
                    phone,
                    email,
                    title,
                    school_key,
                    is_active,
                    notes,
                    updated_at,
                    data_source,
                    staff_id,
                ),
            )

    def write(self, results, mode="upsert", external_events=()):
        if mode != "upsert":
            raise ValueError(
                "DatabaseWriter only supports the safe 'upsert' mode. "
                "Use refresh_database.py for a confirmed full reload."
            )

        values = DatabaseRows(results, external_events=external_events)
        with self.connection() as connection:
            with connection.cursor() as cursor:
                self.upsert_staff(cursor, values.staff())
                cursor.executemany(EVENT_SQL, values.events())
