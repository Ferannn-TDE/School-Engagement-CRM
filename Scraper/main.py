import json
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from dotenv import load_dotenv
from Crawler import NormalWebCrawler
from ScraperStrategies import ScraperContext
from CalendarScraper import EventScraper
from SchoolFacilityUploader import SchoolFacilityUploader
from cps import get_cps_school

SCHOOLS_JSON = "schools.json"
OUTPUT_FILE = "Completed.json"
CONTINUE_FILE = "StillWorking.json"
SETTINGS_FILE = "settings.json"


def load_json(path):
    with open(path) as file:
        return json.load(file)


def save_json(path, data):
    with open(path, "w") as file:
        json.dump(data, file, indent=2)


def upsert_json_value(file_path, key, value):
    with open(file_path, "r") as file:
        data = json.load(file)
    data[key] = value
    save_json(file_path, data)


def run_calendar_scraper():
    try:
        EventScraper().run()
    except Exception as e:
        print(f"calendar scraper failed: {type(e).__name__}")


def run_cps_scraper():
    try:
        get_cps_school()
    except Exception as e:
        print(f"cps scraper failed: {type(e).__name__}")


def run_school_facility_uploader():
    try:
        uploader = SchoolFacilityUploader(
            supabase_url=os.environ.get("SUPABASE_URL"),
            supabase_key=os.environ.get("SUPABASE_KEY"),
            table_name="school_facilities",
            download_url="https://www.isbe.net/_layouts/Download.aspx?SourceUrl=/Documents/dir_ed_entities.xls",
        )
        uploader.run()
    except Exception as e:
        print(f"school facility uploader failed: {type(e).__name__}")


def get_school_batch(schools, settings):
    global_settings = settings.get("global", {})
    batch_size = int(global_settings.get("normal_webcrawler_counter", 100))
    start_index = int(global_settings.get("normal_webcrawler_start_index", 0))

    if start_index >= len(schools):
        start_index = 0

    end_index = min(start_index + batch_size, len(schools))
    return schools[start_index:end_index], start_index, end_index


def update_next_start_index(settings, next_start_index):
    if "global" not in settings:
        settings["global"] = {}
    settings["global"]["normal_webcrawler_start_index"] = next_start_index
    save_json(SETTINGS_FILE, settings)




def main():
    load_dotenv()

    schools = load_json(SCHOOLS_JSON)
    settings = load_json(SETTINGS_FILE)
    contact_paths = settings.get("global", {}).get("contact_paths", [])
    run_calendar_scraper()
    run_cps_scraper()

    schools_batch, start_index, end_index = get_school_batch(schools, settings)

    for school in schools_batch:
        selenium = None

        try:
            options = Options()
            options.add_argument("--headless=new")
            options.add_argument("--window-size=1920,1080")
            selenium = webdriver.Chrome(options=options)

            school_name = school["FacilityName"]
            school_city = school["City"]
            url = school["Website"]
            if url == "http://www.cps.edu":
                continue
            if url is None:
                continue
            selenium.get(url)
            crawler = NormalWebCrawler()
            school_url = crawler.resolve_school(selenium, url, school_name, school_city)
            scraper = ScraperContext(selenium)
            result = scraper.scrape_school(school, contact_paths, school_url)



            records = result["records"]
            school_urls = result["school_urls"]
            if records:
                print(f"{school_name} {len(records)} contacts")
                upsert_json_value(
                    OUTPUT_FILE,
                    school_name,
                    {
                        "school_urls": school_urls,
                        "contacts": records,
                    },
                )
            else:
                print(f"{school_name} No contacts found.")
                upsert_json_value(
                    CONTINUE_FILE,
                    school_name,
                    {
                        "school_urls": school_urls,
                        "contacts": [],
                    },
                )

        except Exception as e:
            print(f"school {school_name} raised an exception{type(e).__name__}")
        finally:
            if selenium:
                selenium.quit()

    next_start_index = 0 if end_index >= len(schools) else end_index
    update_next_start_index(settings, next_start_index)
    run_school_facility_uploader()





if __name__ == "__main__":
    main()