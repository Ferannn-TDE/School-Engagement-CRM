from datetime import datetime

from helpers import (
    DISTRICT_FIND_SQL,
    DISTRICT_SQL,
    DISTRICT_UPDATE_SQL,
    EVENT_SQL,
    SCHOOL_SQL,
    STAFF_FIND_EMAIL_SQL,
    STAFF_FIND_NAME_SQL,
    STAFF_FIND_PHONE_SQL,
    STAFF_SQL,
    STAFF_UPDATE_SQL,
    STATE_NAMES,
    canonical_facility_key,
    clean,
    county_name,
    normalize,
    normalize_event_title,
    score_text,
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
            canonical_facility_key(result.school.facility_key, result.school.state),
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
                clean(result.school.county) or None,
                result.school.state,
            )
        return [(key, rows[key]) for key in sorted(rows)]

    def schools(self, district_ids):
        rows = []
        for result in self.results:
            school = result.school
            resolution = result.resolution
            rows.append((
                canonical_facility_key(school.facility_key, school.state),
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
                clean(school.county) or None,
                True,
                True,
                None,
                self.now,
                self.now,
                school.enrollment,
                school.grades or None,
                school.data_source,
                False,
                None,
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
                notes = score_text(contact.score)
                rows[key] = (
                    contact.name,
                    self.contact_phone(contact),
                    contact.email or None,
                    contact.title,
                    canonical_facility_key(result.school.facility_key, result.school.state),
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

    @staticmethod
    def event_location(event, homepage="", source_label="Calendar"):
        location = clean(event.location)
        source_url = clean(event.source_url)
        homepage = clean(homepage)
        values = [location] if location else []

        if source_url and source_url == homepage:
            values.append(f"{source_label}/Homepage: {source_url}")
        else:
            if source_url:
                values.append(f"{source_label}: {source_url}")
            if homepage:
                values.append(f"Homepage: {homepage}")

        return " | ".join(values) or None

    def contacts(self, staff_ids):
        rows = set()
        for result in self.results:
            for contact in result.contacts:
                key = self.contact_key(result, contact)
                if key in staff_ids:
                    rows.add((
                        canonical_facility_key(result.school.facility_key, result.school.state),
                        staff_ids[key],
                    ))
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
                    canonical_facility_key(result.school.facility_key, result.school.state),
                    self.event_location(event, result.resolution.resolved_url),
                    start.time().replace(microsecond=0),
                    start.date(),
                    None,
                    True,
                    external_id,
                    normalize_event_title(event.title),
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
                self.event_location(event, source_label="Source"),
                start.time().replace(microsecond=0),
                start.date(),
                None,
                True,
                external_id,
                normalize_event_title(event.title),
                self.now,
                self.now,
            )
        return [rows[key] for key in sorted(rows)]

class DatabaseWriter:
    def __init__(self, database_url, connect=None):
        if not database_url:
            raise ValueError(
                "DATABASE_URL is required when database upload is enabled."
            )

        if connect is not None and not callable(connect):
            raise TypeError("connect must be a callable connection factory.")

        self.database_url = database_url
        self.connect = connect

    def connection(self):
        if self.connect is not None:
            return self.connect(self.database_url)

        import psycopg

        return psycopg.connect(
            self.database_url,
            connect_timeout=15,
        )

    def find_staff(self, cursor, values):
        name, phone, email, title, school_key = values[:5]
        if email:
            cursor.execute(STAFF_FIND_EMAIL_SQL, (email, school_key))
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

    @staticmethod
    def upsert_districts(cursor, records):
        district_ids = {}

        for key, values in records:
            name, county, state = values
            cursor.execute(DISTRICT_FIND_SQL, (state, name, county))
            row = cursor.fetchone()

            if row:
                district_id = row[0]
                cursor.execute(
                    DISTRICT_UPDATE_SQL,
                    (name, county, state, district_id),
                )
            else:
                cursor.execute(DISTRICT_SQL, values)
                row = cursor.fetchone()
                if not row:
                    raise RuntimeError(f"PostgreSQL did not return an ID for {name}.")
                district_id = row[0]

            district_ids[key] = district_id

        return district_ids

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
                "Use a separate full reload workflow for confirmed replacements."
            )

        values = DatabaseRows(
            results,
            external_events=external_events,
        )

        with self.connection() as connection:
            with connection.cursor() as cursor:
                district_ids = self.upsert_districts(
                    cursor,
                    values.districts(),
                )

                schools = values.schools(district_ids)
                if schools:
                    cursor.executemany(SCHOOL_SQL, schools)

                self.upsert_staff(
                    cursor,
                    values.staff(),
                )

                events = values.events()
                if events:
                    cursor.executemany(EVENT_SQL, events)