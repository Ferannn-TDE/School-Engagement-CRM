import logging
from data_integrity import COUNTY_SQL, STATE_SQL, CONTACT_SQL, verify_protection

from datetime import datetime

from helpers import (
    ARCHIVED_SCHOOLS_SQL,
    DISTRICT_FIND_SQL,
    DISTRICT_SQL,
    EVENT_SQL,
    TESTING_DATE_CATEGORY,
    MISSED_STAFF_SQL,
    SCHOOL_SETTINGS_SQL,
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
    stable_text,
    utc_now,
)


def source_status(result):
    """The school website as this run saw it (db/011): working, broken or not_found."""
    resolution = result.resolution
    if resolution.resolved:
        return "working"
    if resolution.status == "error":
        return "broken"
    if resolution.reason == "missing_official_seed":
        return "not_found"
    first = resolution.trace[0] if resolution.trace else {}
    if isinstance(first, dict) and first.get("error"):
        return "broken"  # the school's own link didn't load
    return "not_found"  # the link loads, but no school homepage was confirmed


def staff_pages_read(result):
    """True when this run actually read the school's staff pages."""
    return bool(result.contact_pages) and not result.error


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
                school.school_type,
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
                None,  # priority_tier: the client's; the lookup result is source_status
                school.state,
                self.now,
                source_status(result),
                self.now,
            ))
        return rows

    @staticmethod
    def score(contact):
        """The confidence score for staff.scraper_score (db/014), 2 decimals."""
        try:
            return round(float(contact.score), 2)
        except (TypeError, ValueError):
            return None

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
                rows[key] = (
                    contact.name,
                    self.contact_phone(contact),
                    contact.email or None,
                    contact.title,
                    canonical_facility_key(result.school.facility_key, result.school.state),
                    True,
                    True,
                    None,  # notes: never written by the scraper
                    self.now,
                    self.now,
                    contact.method,
                    False,
                    None,
                    self.score(contact),
                    self.now,
                    self.now,
                )
        return [(key, rows[key]) for key in sorted(rows)]

    @staticmethod
    def school_location(school):
        state_zip = " ".join(
            value for value in (clean(school.state), clean(school.zipcode)) if value
        )
        return ", ".join(
            value for value in (clean(school.address), clean(school.city), state_zip) if value
        ) or None

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
                # Store the local (Central) start; external_id below still uses the
                # UTC `start` so existing events keep their ids (plan item B5b).
                # Once merged, remove the app's workarounds in the same release:
                #   src/components/events/EventForm.tsx  (timeLocked, read-only times)
                #   src/services/eventsService.ts        (utcToCentral on read)
                # together with a one-time migration converting school-calendar rows
                # already stored in UTC, or those rows will show shifted times.
                try:
                    start = datetime.fromisoformat(event.start_local or event.start)
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
                    self.school_location(result.school),
                    start.time().replace(microsecond=0),
                    start.date(),
                    None,
                    True,
                    external_id,
                    normalize_event_title(event.title),
                    self.now,
                    self.now,
                    # Testing dates get their category (db/007); everything else is
                    # outreach and has none.
                    TESTING_DATE_CATEGORY if event.category == TESTING_DATE_CATEGORY else None,
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
                clean(event.location) or None,
                start.time().replace(microsecond=0),
                start.date(),
                None,
                True,
                external_id,
                normalize_event_title(event.title),
                self.now,
                self.now,
                None,  # IACAC fairs are outreach
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
        self.integrity_review = []

    def connection(self):
        if self.connect is not None:
            return self.connect(self.database_url)

        import psycopg

        return psycopg.connect(
            self.database_url,
            connect_timeout=15,
        )

    def read_school_settings(self):
        """Per school (canonical facility_key): archived, website_override and
        staff_page_override, read at the start of a run (Part 3)."""
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(SCHOOL_SETTINGS_SQL)
                return {
                    key: {
                        "archived": bool(archived),
                        "website_override": website or "",
                        "staff_page_override": staff_page or "",
                    }
                    for key, archived, website, staff_page in cursor.fetchall()
                }

    @staticmethod
    def archived_schools(cursor):
        cursor.execute(ARCHIVED_SCHOOLS_SQL)
        return {row[0] for row in (cursor.fetchall() or [])}

    def find_staff(self, cursor, values):
        """(staff_id, archived) of the matching person, or None.

        Order: email, then phone (with name), then name + school. The job title is
        deliberately not used: it is the field clients most often correct in the
        app, and matching on it inserted duplicates (plan item C10)."""
        name, phone, email, title, school_key = values[:5]
        if email:
            cursor.execute(STAFF_FIND_EMAIL_SQL, (email, school_key))
            row = cursor.fetchone()
            if row:
                return row[0], bool(row[1])
        if phone:
            cursor.execute(STAFF_FIND_PHONE_SQL, (school_key, name, phone))
            row = cursor.fetchone()
            if row:
                return row[0], bool(row[1])
        email_or_none = email or None
        cursor.execute(STAFF_FIND_NAME_SQL, (school_key, name, email_or_none, email_or_none))
        row = cursor.fetchone()
        return (row[0], bool(row[1])) if row else None

    def upsert_districts(self, cursor, records):
        district_ids = {}

        for key, values in records:
            name, county, state = values
            cursor.execute(DISTRICT_FIND_SQL, (state, name, county))
            row = cursor.fetchone()

            if row:
                district_id = row[0]
                cursor.execute("SELECT district_name, county_name, state_code FROM district WHERE district_id = %s", (district_id,))
                existing = cursor.fetchone()
                if existing and tuple(existing) != tuple(values):
                    self.integrity_review.append({"table": "district", "id": district_id,
                                                  "reason": "existing_district_preserved",
                                                  "stored": list(existing), "proposed": list(values)})
            else:
                cursor.execute(DISTRICT_SQL, values)
                row = cursor.fetchone()
                if not row:
                    raise RuntimeError(f"PostgreSQL did not return an ID for {name}.")
                district_id = row[0]

            district_ids[key] = district_id

        return district_ids

    def upsert_staff(self, cursor, records, archived_schools=frozenset()):
        """Writes the staff and returns the ids of everyone found in this run."""
        found_ids = set()
        for _, values in records:
            if values[4] in archived_schools:
                continue  # the school is archived: leave its staff alone (Part 3)
            found = self.find_staff(cursor, values)
            if found is None:
                cursor.execute(STAFF_SQL, values)
                row = cursor.fetchone()
                if row:
                    found_ids.add(row[0])
                    cursor.execute(CONTACT_SQL, (values[4], row[0]))
                continue
            staff_id, archived = found
            if archived:
                continue  # archived on purpose: neither update nor re-add (Part 3)
            cursor.execute("SELECT school_worked_at FROM staff WHERE staff_id = %s FOR UPDATE", (staff_id,))
            parent = cursor.fetchone()
            if not parent or parent[0] != values[4]:
                self.integrity_review.append({"table": "staff", "id": staff_id,
                                              "reason": "cross_school_match_preserved",
                                              "proposed_school": values[4]})
                continue
            found_ids.add(staff_id)

            name, phone, email, title, school_key = values[:5]
            is_active = values[6]
            updated_at = values[9]
            data_source = values[10]
            score, score_at, scraped_at = values[13], values[14], values[15]
            cursor.execute(
                STAFF_UPDATE_SQL,
                (
                    name,
                    phone,
                    email,
                    title,
                    is_active,
                    score,
                    score,
                    score_at,
                    scraped_at,
                    updated_at,
                    data_source,
                    staff_id,
                    school_key,
                ),
            )
        return found_ids

    def write(self, results, mode="upsert", external_events=(), complete=False):
        """complete=True only when this run covered the whole roster: then records it
        used to find but didn't are counted as missed (db/011)."""
        if mode != "upsert":
            raise ValueError(
                "DatabaseWriter only supports the safe 'upsert' mode. "
                "Use a separate full reload workflow for confirmed replacements."
            )

        self.integrity_review = []
        values = DatabaseRows(
            results,
            external_events=external_events,
        )

        with self.connection() as connection:
            with connection.cursor() as cursor:
                # Archived schools, their staff and their events are left as they are
                # (db/009, Part 3), even if the run found them.
                verify_protection(cursor)
                archived = self.archived_schools(cursor)
                cursor.execute("SELECT facility_key, state_code, name, is_scraped, archived, is_active, district_id FROM schools")
                existing = {row[0]: row for row in cursor.fetchall()}
                keys = [canonical_facility_key(r.school.facility_key, r.school.state) for r in values.results]
                cursor.execute("SELECT facility_key, state_code, name, is_scraped, archived, is_active, district_id FROM schools WHERE facility_key = ANY(%s) ORDER BY facility_key FOR UPDATE", (keys,))
                existing.update({row[0]: row for row in cursor.fetchall()})
                names = {(row[1], normalize(row[2])): row[0] for row in existing.values()}
                accepted = []
                seen_keys = set()
                for result in values.results:
                    school = result.school
                    key = canonical_facility_key(school.facility_key, school.state)
                    old = existing.get(key)
                    duplicate = names.get((school.state, normalize(school.name)))
                    reason = None
                    if not school.name or school.state not in STATE_NAMES or not key.startswith(school.state + ":"):
                        reason = "invalid_source_identity"
                    elif key in seen_keys:
                        reason = "repeated_source_identity"
                    elif old and (old[1] != school.state or not old[3] or old[4] or old[5] is False):
                        reason = "protected_or_mismatched_school"
                    elif not old and duplicate and duplicate != key:
                        reason = "possible_duplicate_school"
                    if reason:
                        self.integrity_review.append({"table": "schools", "id": key, "reason": reason})
                        continue
                    accepted.append(result)
                    seen_keys.add(key)
                    names[(school.state, normalize(school.name))] = key
                values.results = accepted
                if values.results:
                    cursor.executemany(STATE_SQL, values.states())
                    cursor.executemany(COUNTY_SQL, sorted({
                        (clean(r.school.county), r.school.state) for r in values.results if clean(r.school.county)
                    }))

                new_results = [r for r in values.results
                               if canonical_facility_key(r.school.facility_key, r.school.state) not in existing]
                district_ids = self.upsert_districts(cursor, DatabaseRows(new_results).districts())
                for result in values.results:
                    school = result.school
                    old = existing.get(canonical_facility_key(school.facility_key, school.state))
                    if old is None:
                        continue
                    district_ids.setdefault(values.district_key(result), old[6])
                    cursor.execute("SELECT district_name, county_name, state_code FROM district WHERE district_id = %s", (old[6],))
                    stored = cursor.fetchone()
                    proposed = (school.district_name or "Unknown district", clean(school.county) or None, school.state)
                    if stored is None or tuple(stored) != proposed:
                        self.integrity_review.append({"table": "district", "id": old[6],
                                                      "school": old[0], "reason": "existing_district_preserved",
                                                      "stored": list(stored) if stored else None,
                                                      "proposed": list(proposed)})

                schools = [row for row in values.schools(district_ids) if row[0] not in archived]
                if schools:
                    cursor.executemany(SCHOOL_SQL, schools)

                found_staff = self.upsert_staff(
                    cursor,
                    values.staff(),
                    archived,
                )

                events = [row for row in values.events() if row[0] not in archived]
                for event in events:
                    cursor.execute("SELECT event_id, schools_involved, location, time, date, attendance, is_scraped, external_id, fair_name, created_at, updated_at, category FROM events WHERE external_id = %s", (event[6],))
                    old_event = cursor.fetchone()
                    if old_event:
                        columns = (0, 1, 2, 3, 7, 10)
                        if any(old_event[i + 1] != event[i] for i in columns):
                            self.integrity_review.append({"table": "events", "id": old_event[0],
                                                          "reason": "existing_event_preserved",
                                                          "external_id": event[6],
                                                          "fields": ["schools_involved", "location", "time", "date", "fair_name", "category"],
                                                          "stored": [old_event[i + 1] for i in columns],
                                                          "proposed": [event[i] for i in columns]})
                        continue
                    cursor.execute(EVENT_SQL, event)

                if complete:
                    checked = sorted({
                        canonical_facility_key(r.school.facility_key, r.school.state)
                        for r in values.results
                        if staff_pages_read(r)
                    } - archived)
                    # There is no source/state coverage proof here for the entire database.
                    # Preserve existing missing-school counters rather than flag other states.
                    logging.getLogger(__name__).info("Global missing-school updates are disabled; coverage is not proven.")
                    cursor.execute(MISSED_STAFF_SQL, (values.now, checked, sorted(found_staff)))