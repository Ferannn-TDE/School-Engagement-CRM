import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv
from supabase import create_client
from supabase.client import ClientOptions


class SupabaseCRMUpserter:
    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        schema: str = "public",
        batch_size: int = 500,
    ) -> None:
        load_dotenv()
        self.supabase_url = supabase_url or os.getenv("SUPABASE_URL")
        self.supabase_key = (
            supabase_key
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_KEY")
        )
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY environment variable")

        self.batch_size = batch_size
        self.client = create_client(
            self.supabase_url,
            self.supabase_key,
            options=ClientOptions(
                schema=schema,
                postgrest_client_timeout=20,
                storage_client_timeout=20,
            ),
        )

    @staticmethod
    def _safe_int(value: Any) -> Optional[int]:
        if value is None:
            return None
        if isinstance(value, int):
            return value
        text = str(value).strip()
        if not text or text.lower() in {"none", "null", "(pending)", "pending"}:
            return None
        try:
            return int(float(text))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _clean_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text if text else None

    @staticmethod
    def _normalize_text(value: Any) -> str:
        if value is None:
            return ""
        return " ".join(str(value).strip().lower().split())

    @staticmethod
    def _normalize_key_part(value: Any) -> str:
        text = (value or "").strip().lower()
        return " ".join(text.split())

    @classmethod
    def _normalize_facility_key(cls, key: str) -> str:
        parts = key.split("|")
        return "|".join(cls._normalize_key_part(part) for part in parts)

    @classmethod
    def _build_facility_key(cls, row: Dict[str, Any]) -> Optional[str]:
        existing = cls._clean_text(row.get("FacilityKey"))
        if existing:
            return existing

        county = cls._clean_text(row.get("County")) or ""
        name = cls._clean_text(row.get("FacilityName")) or ""
        city = cls._clean_text(row.get("City")) or ""
        zipcode = cls._clean_text(row.get("Zip")) or ""

        if name and city:
            return f"{county}|{name}|{city}|{zipcode}"

        nces_id = cls._clean_text(row.get("NCES_ID"))
        if nces_id and nces_id.lower() not in {"none", "null", "(pending)", "pending"}:
            return f"nces|{nces_id}"

        return None

    @staticmethod
    def _chunks(rows: List[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
        for i in range(0, len(rows), size):
            yield rows[i : i + size]

    def _batched_upsert(self, table: str, rows: List[Dict[str, Any]], conflict_cols: List[str]) -> int:
        if not rows:
            return 0

        total = 0
        conflict = ",".join(conflict_cols)
        for batch in self._chunks(rows, self.batch_size):
            self.client.table(table).upsert(batch, on_conflict=conflict).execute()
            total += len(batch)
        return total

    def _batched_insert(self, table: str, rows: List[Dict[str, Any]]) -> int:
        if not rows:
            return 0

        total = 0
        for batch in self._chunks(rows, self.batch_size):
            self.client.table(table).insert(batch).execute()
            total += len(batch)
        return total

    def load_schools_json(self, json_path: str) -> List[Dict[str, Any]]:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            raise ValueError("schools.json must be a JSON array")
        return [row for row in data if isinstance(row, dict)]

    def load_completed_json(self, json_path: str) -> Dict[str, Any]:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("Completed.json must be a JSON object keyed by school name")
        return data

    def load_cps_schools_json(self, json_path: str) -> Dict[str, Any]:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("cps_schools.json must be a JSON object keyed by school name")
        return data

    def upsert_county_from_schools(self, schools: List[Dict[str, Any]]) -> int:
        seen = set()
        county_rows: List[Dict[str, Any]] = []

        for school in schools:
            county = self._clean_text(school.get("County"))
            if not county:
                continue
            key = self._normalize_key_part(county)
            if key in seen:
                continue
            seen.add(key)
            county_rows.append({"county_name": key.title()})

        return self._batched_upsert("county", county_rows, ["county_name"])

    def upsert_district(self, district_rows: List[Dict[str, Any]]) -> Tuple[int, int]:
        if not district_rows:
            return 0, 0

        with_id: List[Dict[str, Any]] = []
        without_id: List[Dict[str, Any]] = []

        for row in district_rows:
            payload = {
                "district_name": self._clean_text(row.get("district_name")),
                "county_name": self._clean_text(row.get("county_name")),
            }
            district_id = self._safe_int(row.get("district_id"))
            if district_id is not None:
                payload["district_id"] = district_id
                with_id.append(payload)
            else:
                without_id.append(payload)

        upserted = self._batched_upsert("district", with_id, ["district_id"]) if with_id else 0
        inserted = self._batched_insert("district", without_id) if without_id else 0
        return upserted, inserted

    def upsert_schools_from_json(
        self,
        schools: List[Dict[str, Any]],
        district_by_facility_key: Optional[Dict[str, int]] = None,
    ) -> int:
        dedup: Dict[str, Dict[str, Any]] = {}

        for s in schools:
            facility_key = self._build_facility_key(s)
            if not facility_key:
                continue
            normalized_facility_key = self._normalize_facility_key(facility_key)

            district_id = None
            if district_by_facility_key:
                district_id = district_by_facility_key.get(normalized_facility_key)

            row = {
                "facility_key": normalized_facility_key,
                "name": self._clean_text(s.get("FacilityName")) or "Unknown School",
                "district_id": district_id,
                "phone_number": self._clean_text(s.get("Telephone")),
                "address": None,
                "class_size": None,
                "rating": None,
                "type_of_school": None,
                "admin": self._clean_text(s.get("Administrator")),
                "city": self._clean_text(s.get("City")),
                "zipcode": self._clean_text(s.get("Zip")),
                "grades_served": None,
                "website": self._clean_text(s.get("Website")),
                "county_name": (
                    self._normalize_key_part(s.get("County")).title()
                    if self._clean_text(s.get("County"))
                    else None
                ),
            }

            dedup[normalized_facility_key] = row

        rows = list(dedup.values())
        return self._batched_upsert("schools", rows, ["facility_key"])

    def upsert_schools_from_cps_json(self, cps_data: Dict[str, Any]) -> int:
        dedup: Dict[str, Dict[str, Any]] = {}

        for school_name, school_blob in cps_data.items():
            if not isinstance(school_blob, dict):
                continue

            name = self._clean_text(school_blob.get("name")) or self._clean_text(school_name)
            if not name:
                continue

            facility_key = self._build_cps_facility_key(name)
            top2 = self._extract_cps_top2_contacts(school_blob)
            admin_name = top2[0]["name"] if top2 else None

            row = {
                "facility_key": facility_key,
                "name": name,
                "district_id": None,
                "phone_number": self._clean_text(school_blob.get("phone")),
                "address": None,
                "class_size": None,
                "rating": None,
                "type_of_school": None,
                "admin": admin_name,
                "city": None,
                "zipcode": None,
                "grades_served": None,
                "website": self._clean_text(school_blob.get("website")),
                "county_name": None,
            }

            dedup[facility_key] = row

        return self._batched_upsert("schools", list(dedup.values()), ["facility_key"])

    def _build_cps_facility_key(self, school_name: str) -> str:
        normalized = self._normalize_text(school_name)
        slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
        return f"cps|{slug}"

    def _extract_cps_top2_contacts(self, school_blob: Dict[str, Any]) -> List[Dict[str, Optional[str]]]:
        contacts = school_blob.get("contacts", {})
        if not isinstance(contacts, dict):
            return []

        result: List[Dict[str, Optional[str]]] = []
        for slot in ("administrator", "second"):
            person = contacts.get(slot, {})
            if not isinstance(person, dict):
                continue

            name = self._clean_text(person.get("name"))
            if not name:
                continue

            result.append(
                {
                    "slot": slot,
                    "name": name,
                    "job_name": self._clean_text(person.get("title")),
                }
            )
        return result
    
    def list_cps_top2_contacts(self, cps_data: Dict[str, Any]) -> List[Dict[str, Optional[str]]]:
        listing: List[Dict[str, Optional[str]]] = []

        for school_name, school_blob in cps_data.items():
            if not isinstance(school_blob, dict):
                continue

            name = self._clean_text(school_blob.get("name")) or self._clean_text(school_name)
            if not name:
                continue

            facility_key = self._build_cps_facility_key(name)
            phone = self._clean_text(school_blob.get("phone"))
            website = self._clean_text(school_blob.get("website"))

            top2 = self._extract_cps_top2_contacts(school_blob)
            for idx, person in enumerate(top2, start=1):
                listing.append(
                    {
                        "school_name": name,
                        "facility_key": facility_key,
                        "contact_rank": str(idx),
                        "contact_name": person.get("name"),
                        "job_name": person.get("job_name"),
                        "phone": phone,
                        "website": website,
                    }
                )

        return listing

    def upsert_staff_info(self, staff_rows: List[Dict[str, Any]]) -> Tuple[int, int]:
        with_id: List[Dict[str, Any]] = []
        without_id: List[Dict[str, Any]] = []

        for row in staff_rows:
            name = self._clean_text(row.get("name"))
            if not name:
                continue

            payload = {
                "name": name,
                "phone": self._clean_text(row.get("phone")),
                "email": self._clean_text(row.get("email")),
                "job_name": self._clean_text(row.get("job_name")),
                "school_worked_at": self._clean_text(row.get("school_worked_at")),
            }

            staff_id = self._safe_int(row.get("staff_id"))
            if staff_id is not None:
                payload["staff_id"] = staff_id
                with_id.append(payload)
            else:
                without_id.append(payload)

        upserted = self._batched_upsert("staff_info", with_id, ["staff_id"]) if with_id else 0
        inserted = self._batched_insert("staff_info", without_id) if without_id else 0
        return upserted, inserted

    def _staff_dedupe_key(
        self,
        name: Any,
        email: Any,
        job_name: Any,
        school_worked_at: Any,
    ) -> Tuple[str, str, str, str]:
        return (
            self._normalize_text(name),
            self._normalize_text(email),
            self._normalize_text(job_name),
            self._normalize_text(school_worked_at),
        )

    def upsert_staff_from_completed_json(
        self,
        schools: List[Dict[str, Any]],
        completed: Dict[str, Any],
    ) -> Dict[str, int]:
        facility_by_school_name: Dict[str, str] = {}
        for s in schools:
            school_name = self._clean_text(s.get("FacilityName"))
            facility_key = self._build_facility_key(s)
            if not school_name or not facility_key:
                continue
            normalized_key = self._normalize_facility_key(facility_key)
            facility_by_school_name[self._normalize_text(school_name)] = normalized_key

        incoming_by_key: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}
        skipped_unknown_school = 0

        for school_name, school_blob in completed.items():
            if not isinstance(school_blob, dict):
                continue

            school_key = self._normalize_text(school_name)
            facility_key = facility_by_school_name.get(school_key)
            if not facility_key:
                skipped_unknown_school += 1
                continue

            contacts = school_blob.get("contacts", [])
            if not isinstance(contacts, list):
                continue

            for c in contacts:
                if not isinstance(c, dict):
                    continue

                name = self._clean_text(c.get("name"))
                if not name:
                    continue

                payload = {
                    "name": name,
                    "phone": self._clean_text(c.get("phone")),
                    "email": self._clean_text(c.get("email")),
                    "job_name": self._clean_text(c.get("title")),
                    "school_worked_at": facility_key,
                }

                dedupe_key = self._staff_dedupe_key(
                    payload["name"],
                    payload["email"],
                    payload["job_name"],
                    payload["school_worked_at"],
                )
                incoming_by_key[dedupe_key] = payload

        existing_staff_id_by_key: Dict[Tuple[str, str, str, str], int] = {}
        offset = 0
        limit = 1000

        while True:
            response = (
                self.client.table("staff_info")
                .select("staff_id,name,email,job_name,school_worked_at")
                .range(offset, offset + limit - 1)
                .execute()
            )
            rows = response.data or []
            if not rows:
                break

            for r in rows:
                staff_id = r.get("staff_id")
                if staff_id is None:
                    continue
                key = self._staff_dedupe_key(
                    r.get("name"),
                    r.get("email"),
                    r.get("job_name"),
                    r.get("school_worked_at"),
                )
                existing_staff_id_by_key[key] = int(staff_id)

            offset += limit

        with_id: List[Dict[str, Any]] = []
        without_id: List[Dict[str, Any]] = []

        for key, payload in incoming_by_key.items():
            existing_id = existing_staff_id_by_key.get(key)
            if existing_id is not None:
                row = dict(payload)
                row["staff_id"] = existing_id
                with_id.append(row)
            else:
                without_id.append(payload)

        upserted = self._batched_upsert("staff_info", with_id, ["staff_id"]) if with_id else 0
        inserted = self._batched_insert("staff_info", without_id) if without_id else 0

        return {
            "staff_upserted_with_id": upserted,
            "staff_inserted_without_id": inserted,
            "staff_skipped_unknown_school": skipped_unknown_school,
            "staff_unique_incoming": len(incoming_by_key),
        }

    def upsert_staff_from_cps_json(self, cps_data: Dict[str, Any]) -> Dict[str, int]:
        incoming_by_key: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}

        for school_name, school_blob in cps_data.items():
            if not isinstance(school_blob, dict):
                continue

            name = self._clean_text(school_blob.get("name")) or self._clean_text(school_name)
            if not name:
                continue

            facility_key = self._build_cps_facility_key(name)
            school_phone = self._clean_text(school_blob.get("phone"))

            top2 = self._extract_cps_top2_contacts(school_blob)
            for person in top2:
                payload = {
                    "name": person.get("name"),
                    "phone": school_phone,
                    "email": None,
                    "job_name": person.get("job_name"),
                    "school_worked_at": facility_key,
                }

                dedupe_key = self._staff_dedupe_key(
                    payload["name"],
                    payload["email"],
                    payload["job_name"],
                    payload["school_worked_at"],
                )
                incoming_by_key[dedupe_key] = payload

        existing_staff_id_by_key = self._load_existing_staff_index()

        with_id: List[Dict[str, Any]] = []
        without_id: List[Dict[str, Any]] = []

        for key, payload in incoming_by_key.items():
            existing_id = existing_staff_id_by_key.get(key)
            if existing_id is not None:
                row = dict(payload)
                row["staff_id"] = existing_id
                with_id.append(row)
            else:
                without_id.append(payload)

        upserted = self._batched_upsert("staff_info", with_id, ["staff_id"]) if with_id else 0
        inserted = self._batched_insert("staff_info", without_id) if without_id else 0

        return {
            "cps_staff_upserted_with_id": upserted,
            "cps_staff_inserted_without_id": inserted,
            "cps_staff_unique_incoming": len(incoming_by_key),
        }

    def _load_existing_staff_index(self) -> Dict[Tuple[str, str, str, str], int]:
        existing_staff_id_by_key: Dict[Tuple[str, str, str, str], int] = {}
        offset = 0
        limit = 1000

        while True:
            response = (
                self.client.table("staff_info")
                .select("staff_id,name,email,job_name,school_worked_at")
                .range(offset, offset + limit - 1)
                .execute()
            )
            rows = response.data or []
            if not rows:
                break

            for r in rows:
                staff_id = r.get("staff_id")
                if staff_id is None:
                    continue
                key = self._staff_dedupe_key(
                    r.get("name"),
                    r.get("email"),
                    r.get("job_name"),
                    r.get("school_worked_at"),
                )
                existing_staff_id_by_key[key] = int(staff_id)

            offset += limit

        return existing_staff_id_by_key

    def upsert_events(self, event_rows: List[Dict[str, Any]]) -> Tuple[int, int]:
        with_id: List[Dict[str, Any]] = []
        without_id: List[Dict[str, Any]] = []

        for row in event_rows:
            payload = {
                "schools_involved": self._clean_text(row.get("schools_involved")),
                "location": self._clean_text(row.get("location")),
                "time": row.get("time"),
                "date": row.get("date"),
                "attendance": self._safe_int(row.get("attendance")),
            }

            event_id = self._safe_int(row.get("event_id"))
            if event_id is not None:
                payload["event_id"] = event_id
                with_id.append(payload)
            else:
                without_id.append(payload)

        upserted = self._batched_upsert("events", with_id, ["event_id"]) if with_id else 0
        inserted = self._batched_insert("events", without_id) if without_id else 0
        return upserted, inserted

    def run_from_schools_json(
        self,
        schools_json_path: str,
        completed_json_path: Optional[str] = "Completed.json",
    ) -> Dict[str, Any]:
        schools = self.load_schools_json(schools_json_path)
        county_count = self.upsert_county_from_schools(schools)
        schools_count = self.upsert_schools_from_json(schools)

        staff_summary = {
            "staff_upserted_with_id": 0,
            "staff_inserted_without_id": 0,
            "staff_skipped_unknown_school": 0,
            "staff_unique_incoming": 0,
        }

        if completed_json_path:
            completed = self.load_completed_json(completed_json_path)
            staff_summary = self.upsert_staff_from_completed_json(schools, completed)

        return {
            "county_upserted": county_count,
            "schools_upserted": schools_count,
            "district_upserted_with_id": 0,
            "district_inserted_without_id": 0,
            "events_upserted_with_id": 0,
            "events_inserted_without_id": 0,
            **staff_summary,
        }

    def run_from_sources(
        self,
        schools_json_path: str = "schools.json",
        completed_json_path: Optional[str] = "Completed.json",
        cps_json_path: Optional[str] = "cps_schools.json",
    ) -> Tuple[Dict[str, Any], List[Dict[str, Optional[str]]]]:
        schools = self.load_schools_json(schools_json_path)
        county_count = self.upsert_county_from_schools(schools)
        schools_count = self.upsert_schools_from_json(schools)

        staff_summary = {
            "staff_upserted_with_id": 0,
            "staff_inserted_without_id": 0,
            "staff_skipped_unknown_school": 0,
            "staff_unique_incoming": 0,
        }

        if completed_json_path:
            completed = self.load_completed_json(completed_json_path)
            staff_summary = self.upsert_staff_from_completed_json(schools, completed)

        cps_schools_upserted = 0
        cps_staff_summary = {
            "cps_staff_upserted_with_id": 0,
            "cps_staff_inserted_without_id": 0,
            "cps_staff_unique_incoming": 0,
        }
        cps_top2_contacts: List[Dict[str, Optional[str]]] = []

        if cps_json_path:
            cps_data = self.load_cps_schools_json(cps_json_path)
            cps_schools_upserted = self.upsert_schools_from_cps_json(cps_data)
            cps_staff_summary = self.upsert_staff_from_cps_json(cps_data)
            cps_top2_contacts = self.list_cps_top2_contacts(cps_data)

        summary = {
            "county_upserted": county_count,
            "schools_upserted": schools_count,
            "cps_schools_upserted": cps_schools_upserted,
            "district_upserted_with_id": 0,
            "district_inserted_without_id": 0,
            "events_upserted_with_id": 0,
            "events_inserted_without_id": 0,
            **staff_summary,
            **cps_staff_summary,
        }
        return summary, cps_top2_contacts


if __name__ == "__main__":
    uploader = SupabaseCRMUpserter()
    summary, cps_top2 = uploader.run_from_sources(
        "schools.json",
        "Completed.json",
        "cps_schools.json",
    )
    print(summary)
