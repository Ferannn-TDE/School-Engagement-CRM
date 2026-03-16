import json
import os
from abc import ABC, abstractmethod
from dotenv import load_dotenv
from supabase import create_client


class SchoolPuller(ABC):
    @abstractmethod
    def get_schools(self):
        pass


class SupabaseSchoolPuller(SchoolPuller):
    def __init__(self, supabase_url=None, supabase_key=None):
        load_dotenv()
        self.supabase_url = supabase_url or os.environ.get("SUPABASE_URL")
        self.supabase_key = supabase_key or os.environ.get("SUPABASE_KEY")
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY")
        self.client = create_client(self.supabase_url, self.supabase_key)
    def get_schools(self):
        response = (
            self.client.table("school_facilities")
            .select("FacilityName, City, Website")
            .execute()
        )
        rows = response.data or []
        schools = []
        for row in rows:
            schools.append(
                {
                    "FacilityName": row.get("FacilityName", ""),
                    "City": row.get("City", ""),
                    "Website": row.get("Website", row.get("website", "")),
                }
            )
        return schools


class JsonSchoolPuller(SchoolPuller):
    def __init__(self, json_path):
        self.json_path = json_path

    def _normalize_row(self, row, fallback_name=""):
        if not isinstance(row, dict):
            return None

        facility_name = (
            row.get("FacilityName")
            or row.get("SchoolName")
            or row.get("School Name")
            or fallback_name
            or ""
        )
        city = row.get("City") or row.get("city") or ""
        website = (
            row.get("Website")
            or row.get("website")
            or row.get("Homepage")
            or row.get("base_url")
            or ""
        )

        school_urls = row.get("school_urls", {})
        if not website and isinstance(school_urls, dict):
            website = school_urls.get("base_url") or school_urls.get("alt_url") or ""

        return {
            "FacilityName": str(facility_name).strip(),
            "City": str(city).strip(),
            "Website": str(website).strip(),
        }

    def get_schools(self):
        with open(self.json_path, "r", encoding="utf-8") as file:
            data = json.load(file)

        schools = []
        if isinstance(data, list):
            for row in data:
                normalized = self._normalize_row(row)
                if normalized:
                    schools.append(normalized)
            return schools

        if isinstance(data, dict):
            for key, row in data.items():
                normalized = self._normalize_row(row, fallback_name=key)
                if normalized:
                    schools.append(normalized)
            return schools

        raise ValueError("JSON school source must be a list or object")


def _school_key(row):
    return (
        str(row.get("FacilityName", "")).strip().lower(),
        str(row.get("City", "")).strip().lower(),
    )


def upsert_schools_json(output_path, incoming_schools):
    try:
        with open(output_path, "r", encoding="utf-8") as file:
            existing_data = json.load(file)
    except FileNotFoundError:
        existing_data = []
    except json.JSONDecodeError:
        existing_data = []

    if not isinstance(existing_data, list):
        raise ValueError("Existing schools.json must be a JSON array")

    merged = []
    index_by_key = {}

    for row in existing_data:
        if not isinstance(row, dict):
            continue
        key = _school_key(row)
        if key in index_by_key:
            continue
        index_by_key[key] = len(merged)
        merged.append(row)

    inserted = 0
    updated = 0
    for row in incoming_schools:
        if not isinstance(row, dict):
            continue
        key = _school_key(row)
        existing_index = index_by_key.get(key)
        if existing_index is None:
            merged.append(row)
            index_by_key[key] = len(merged) - 1
            inserted += 1
            continue

        merged[existing_index].update(row)
        updated += 1

    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(merged, file, indent=2, ensure_ascii=False)
        file.write("\n")

    return inserted, updated, len(merged)


if __name__ == "__main__":
    puller = SupabaseSchoolPuller()
    schools = puller.get_schools()
    output_path = os.path.join(os.path.dirname(__file__), "schools.json")
    inserted_count, updated_count, total_count = upsert_schools_json(output_path, schools)
    print(
        f"Upserted schools.json: inserted={inserted_count}, "
        f"updated={updated_count}, total={total_count}"
    )