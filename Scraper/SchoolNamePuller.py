import csv
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


class CsvSchoolPuller(SchoolPuller):
    def __init__(self, csv_path):
        self.csv_path = csv_path

    def get_schools(self):
        schools = []
        with open(self.csv_path, "r", newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                schools.append(
                    {
                        "FacilityName": row.get("FacilityName", ""),
                        "City": row.get("City", ""),
                        "Website": row.get("Website", row.get("website", "")),
                    }
                )
        return schools


if __name__ == "__main__":
    puller = SupabaseSchoolPuller()
    schools = puller.get_schools()
    print(f"Loaded {len(schools)} schools")