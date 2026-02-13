import os
import pandas as pd
import requests
from io import BytesIO
from supabase import create_client
from supabase.client import ClientOptions
from dotenv import load_dotenv
from typing import List

class SchoolFacilityUploader:

    INT_COLUMNS = ["Type", "School", "StRep", "StSen", "FedCong", "Cat"]
    SHEET_INDICES = (1, 5)

    def __init__(self, supabase_url: str, supabase_key: str, table_name: str, download_url: str):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.table_name = table_name
        self.download_url = download_url
        self.supabase = create_client(
            self.supabase_url, self.supabase_key,
            options=ClientOptions(
                postgrest_client_timeout=10,
                storage_client_timeout=10,
                schema="public"
            )
        )

    def download_excel(self) -> pd.ExcelFile:
        resp = requests.get(self.download_url, stream=True)
        resp.raise_for_status()
        return pd.ExcelFile(BytesIO(resp.content))
    
    def filter_sheet(self, df: pd.DataFrame, sheet_idx: int) -> pd.DataFrame:
        col_idx = 12
        if df.shape[1] <= col_idx:
            return pd.DataFrame()

        df = df.rename(columns={
            "Mailing Address": "MailingAddress",
            "Delivery Address": "DeliveryAddress",
            "NCES ID": "NCES_ID",
            "Region-2\nCounty-3\nDistrict-4": "RegionCountyDistrict"
        })
        if "Affiliation" not in df.columns:
            df["Affiliation"] = None

        filtered = df[
            df.iloc[:, col_idx].str.contains(r'(?:^|[^0-9])12(?:[^0-9]|$)', na=False) &
            df.iloc[:, 1].str.contains(r'\bsch\b', case=False, na=False)
        ]
        return filtered

    def process_dataframes(self, dataframes: List[pd.DataFrame]) -> pd.DataFrame:
        non_empty = [df for df in dataframes if not df.empty]
        if not non_empty:
            return pd.DataFrame()   
           
        result_df = pd.concat(non_empty, ignore_index=True).where(pd.notnull, None)
        result_df["FacilityKey"] = (
            result_df["CountyName"].astype(str) + "|" +
            result_df["FacilityName"].astype(str) + "|" +
            result_df["City"].astype(str) + "|" +
            result_df["Zip"].astype(str)
        )
        cols_to_convert = [c for c in self.INT_COLUMNS if c in result_df.columns]
        if cols_to_convert:
            result_df[cols_to_convert] = result_df[cols_to_convert].apply(pd.to_numeric, errors="coerce").astype("Int64")
        
        return result_df
    
    def upload_to_supabase(self, df: pd.DataFrame) -> None:
        data = df.to_dict(orient="records")
        batch_size = 500
        success_rows = 0
        for i in range(0, len(data), batch_size):
            batch = data[i:i+batch_size]
            table_name = self.table_name
            try:
                self.supabase.table(table_name).upsert(batch, on_conflict=["FacilityKey"]).execute()
                success_rows += len(batch)

            except Exception as exc:
                print(f"Error upserting rows {i}-{i+len(batch)-1} ({len(batch)} rows): {exc}")         
        print(f"Successfully upserted {success_rows} rows into {self.table_name}.")

    def run(self) -> None:
        xls = self.download_excel()
        filtered_dataframes = [
            self.filter_sheet(pd.read_excel(xls, sheet_name=sheet), idx)
            for idx, sheet in enumerate(xls.sheet_names)
            if idx in self.SHEET_INDICES
        ]
        result_df = self.process_dataframes(filtered_dataframes)
        print(f"Collected {len(result_df)} rows.")
        self.upload_to_supabase(result_df)

if __name__ == "__main__":
    load_dotenv()
    uploader = SchoolFacilityUploader(
        supabase_url=os.environ.get("SUPABASE_URL"),
        supabase_key=os.environ.get("SUPABASE_KEY"),
        table_name="school_facilities",
        download_url="https://www.isbe.net/_layouts/Download.aspx?SourceUrl=/Documents/dir_ed_entities.xls"
    )
    uploader.run()