# tests/test_school_facility_uploader.py
import importlib
import pandas as pd

mod = importlib.import_module("SchoolFacilityUploader")


def _make_df():
    row = {
        "CountyName": "Cook",                             
        "SearchToken": "sch",                             
        "FacilityName": "Alpha HS",                       
        "City": "Chicago",                                
        "Zip": "60601",                                   
        "Mailing Address": "m",                          
        "Delivery Address": "d",                          
        "NCES ID": "123",                                
        "Region-2\nCounty-3\nDistrict-4": "x",           
        "Affiliation": None,                             
        "Type": "1",                                     
        "School": "1",                                    
        "GradesServed": "12",                             
        "StRep": "1",                                   
        "StSen": "1",                                    
        "FedCong": "1",                                  
        "Cat": "1",                                      
    }

    cols = [
        "CountyName",
        "SearchToken",
        "FacilityName",
        "City",
        "Zip",
        "Mailing Address",
        "Delivery Address",
        "NCES ID",
        "Region-2\nCounty-3\nDistrict-4",
        "Affiliation",
        "Type",
        "School",
        "GradesServed",
        "StRep",
        "StSen",
        "FedCong",
        "Cat",
    ]
    return pd.DataFrame([row], columns=cols)

def test_filter_sheet_returns_high_school_rows():
    obj = mod.SchoolFacilityUploader.__new__(mod.SchoolFacilityUploader)
    df = _make_df()
    out = obj.filter_sheet(df, 0)
    assert len(out) == 1
    assert "MailingAddress" in out.columns
    assert "NCES_ID" in out.columns


def test_process_dataframes_builds_facility_key():
    obj = mod.SchoolFacilityUploader.__new__(mod.SchoolFacilityUploader)
    out = obj.process_dataframes([_make_df()])
    assert len(out) == 1
    assert out.iloc[0]["FacilityKey"] == "Cook|Alpha HS|Chicago|60601"