import json
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from ScraperStrategies import ScraperContext

SCHOOLS_JSON = "schools.json"
OUTPUT_FILE = "Completed.json"
CONTINUE_FILE = "StillWorking.json"
SETTINGS_FILE = "settings.json"


def load_json(path):
    with open(path) as file:
        return json.load(file)


def upsert_json_value(file_path, key, value):
    try:
        with open(file_path, "r") as file:
            data = json.load(file)
    except FileNotFoundError:
        data = {}

    data[key] = value

    with open(file_path, "w") as file:
        json.dump(data, file, indent=2)


def main():
    schools = load_json(SCHOOLS_JSON)
    settings = load_json(SETTINGS_FILE)

    alt_urls = settings.get("school_rules", {})
    contact_paths = settings.get("global", {}).get("contact_paths", [])
    start_index = 0



    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    driver = webdriver.Chrome(options=options)

    context = ScraperContext(driver)

    try:
        print(f"Starting at index {start_index} of {len(schools)} total schools.")
        for school in schools[start_index:]:
            school_name = school["FacilityName"]
            print(f"\nScraping {school_name}...")

            base = (school.get("Website") or "").strip()
            if not base:
                print(f"Skipping {school_name}: missing Website")
                upsert_json_value(CONTINUE_FILE, school_name, {"error": "missing website"})
                continue

            try:
                result = context.scrape_school(school, alt_urls, contact_paths)
            except Exception as e:
                print(f"School failed: {school_name}: {e}")
                continue

            records = result["records"]
            school_urls = result["school_urls"]

            if records:
                print(f"Found {len(records)} contacts:")
                upsert_json_value(
                    OUTPUT_FILE,
                    school_name,
                    {
                        "school_urls": school_urls,
                        "contacts": records,
                    },
                )
            else:
                print("No contacts found.")
                upsert_json_value(
                    CONTINUE_FILE,
                    school_name,
                    {
                        "school_urls": school_urls,
                        "contacts": [],
                    },
                )
    finally:
        driver.quit()


if __name__ == "__main__":
    main()