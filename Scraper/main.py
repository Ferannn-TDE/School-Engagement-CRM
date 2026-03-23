import json
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from Crawler import NormalWebCrawler
from ScraperStrategies import Scraper

SCHOOLS_JSON = "schools.json"
OUTPUT_FILE = "Completed.json"
CONTINUE_FILE = "StillWorking.json"
SETTINGS_FILE = "settings.json"


def load_json(path):
    with open(path) as file:
        return json.load(file)


def upsert_json_value(file_path, key, value):
    with open(file_path, "r") as file:
        data = json.load(file)
    data[key] = value
    with open(file_path, "w") as file:
        json.dump(data, file, indent=2)


def main():
    schools = load_json(SCHOOLS_JSON)
    settings = load_json(SETTINGS_FILE)
    contact_paths = settings.get("global", {}).get("contact_paths", [])
    start_index = 0
    for school in schools[start_index:]:

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
            if url == None:
                continue
            selenium.get(url)
            crawler = NormalWebCrawler()
            school_url = crawler.resolve_school(selenium, url, school_name, school_city)
            scraper = Scraper(selenium)
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
            selenium.quit()

        except Exception as e:
            print(f"school {school_name} raised an exception {e}")
        selenium.quit()


if __name__ == "__main__":
    main()