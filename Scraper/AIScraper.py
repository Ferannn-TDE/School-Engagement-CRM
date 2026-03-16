import asyncio
from abc import ABC, abstractmethod
from collections import OrderedDict
import re
import threading
import csv
from playwright.async_api import async_playwright
from SchoolNamePuller import SupabaseSchoolPuller, JsonSchoolPuller

SCRAPE_BATCH_SIZE = 5
SCRAPE_TIMEOUT_SECONDS = 120
SCRAPE_RUN_INTERVAL_SECONDS = 3600

class AIModel(ABC):
    @abstractmethod
    async def search(self, facility_name, city, website):
        pass

class GeminiModel(AIModel):
    async def search(self, facility_name, city, website):
        async with async_playwright() as plawright:
            browser = await plawright.chromium.launch(headless=False)
            context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            page = await context.new_page()
            await page.goto("https://gemini.google.com/app")
            await page.wait_for_timeout(4000)
            search_query = (
                f"Find deans and career counselors contact information from {facility_name} "
                f"in {city}, Illinois. Website: {website}. "
                "The school services at least grades 9-12. "
                "Return results in a table format with columns: Name, Title, Email, Phone, School Name"
            )
            await page.keyboard.type(search_query)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(4000)
            try:
                await page.wait_for_selector("table", timeout=30000)
            except Exception:
                await browser.close()
                return []
            rows = await page.query_selector_all("table tr")
            contacts = []
            for row_index, row in enumerate(rows):
                if row_index == 0:
                    continue
                cells = await row.query_selector_all("td")
                email = await self._extract_email(cells[2])
                data = {
                    "Name": (await cells[0].text_content() or "").strip(),
                    "Title": (await cells[1].text_content() or "").strip(),
                    "Email": email,
                    "Phone": (await cells[3].text_content() or "").strip(),
                    "School Name": (await cells[4].text_content() or "").strip(),
                }
                contacts.append(data)
            await browser.close()
            await asyncio.sleep(5)
            return contacts
    
    async def _extract_email(self, cell):
        text = (await cell.text_content() or "").strip()
        match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
        if match:
            return match.group(0)        
        try:
            anchors = await cell.query_selector_all("a")
            if anchors:
                href = await anchors[0].get_attribute("href")
                if href and href.lower().startswith("mailto:"):
                    email = href[7:].split("?")[0].strip()
                    if email:
                        return email
        except Exception:
            pass
        return ""

class GeminiModelUrlFetcher(AIModel):
    async def search(self, facility_name, city, website):
        async with async_playwright() as plawright:
            browser = await plawright.chromium.launch(headless=True)
            context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            page = await context.new_page()
            await page.goto("https://gemini.google.com/app")
            await page.wait_for_timeout(4000)
            search_query = (
                f"Find the homepage url of highschool {facility_name} "
                f"in {city}, Illinois. Output the data in a table with schoolname, city, and full url homepage." 
            )
            await page.keyboard.type(search_query)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(4000)
            try:
                await page.wait_for_selector("table", timeout=60000)
            except Exception:
                await browser.close()
                return []
            rows = await page.query_selector_all("table tr")
            urls = []
            for row_index, row in enumerate(rows):
                if row_index == 0:
                    continue
                cells = await row.query_selector_all("td")
                data = {
                    "School Name": (await cells[0].text_content() or "").strip(),
                    "City": (await cells[1].text_content() or "").strip(),
                    "Homepage": (await cells[2].text_content() or "").strip(),
                }
                urls.append(data)
            await browser.close()
            await asyncio.sleep(10)
            return urls

    
    async def _extract_email(self, cell):
        text = (await cell.text_content() or "").strip()
        match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
        if match:
            return match.group(0)        
        try:
            anchors = await cell.query_selector_all("a")
            if anchors:
                href = await anchors[0].get_attribute("href")
                if href and href.lower().startswith("mailto:"):
                    email = href[7:].split("?")[0].strip()
                    if email:
                        return email
        except Exception:
            pass
        return ""

class DocumentWriter(ABC):
    @abstractmethod
    def write(self, records, filename):
        pass

class CsvWriter(DocumentWriter):
    def __init__(self):
        self.lock = threading.Lock()

    def write(self, contacts, filename):
        if not contacts:
            return
        with self.lock:
            headers = ["Name", "Title", "Email", "Phone", "School Name"]
            try:
                with open(filename, 'a', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=headers)
                    if f.tell() == 0:
                        writer.writeheader()
                    writer.writerows(contacts)
            except FileNotFoundError:
                with open(filename, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=headers)
                    writer.writeheader()
                    writer.writerows(contacts)

class CsvUrlWriter(DocumentWriter):
    def __init__(self):
        self.lock = threading.Lock()

    def write(self, urls, filename):
        if not urls:
            return
        with self.lock:
            headers = ["School Name", "City", "Homepage"]
            try:
                with open(filename, 'a', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=headers)
                    if f.tell() == 0:
                        writer.writeheader()
                    writer.writerows(urls)
            except FileNotFoundError:
                with open(filename, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=headers)
                    writer.writeheader()
                    writer.writerows(urls)

class Scraper:
    def __init__(self, ai_model, writer, school_puller):
        self.ai_model = ai_model
        self.writer = writer
        self.school_puller = school_puller

    async def scrape_facility(self, facility):
        return await asyncio.wait_for(
            self.ai_model.search(
                facility.get("FacilityName", ""),
                facility.get("City", ""),
                facility.get("Website", ""),
            ),
            timeout=SCRAPE_TIMEOUT_SECONDS,
        )

    async def run(self, output_file):
        facilities = self.school_puller.get_schools()
        total_contacts = 0
        failed_facilities = []
        for i in range(0, len(facilities), SCRAPE_BATCH_SIZE):
            group = facilities[i:i + SCRAPE_BATCH_SIZE]
            processes = [self.scrape_facility(f) for f in group]
            scrape_data = await asyncio.gather(*processes, return_exceptions=True)
            contacts = []
            for idx, result in enumerate(scrape_data):
                if isinstance(result, Exception):
                    failed_facilities.append(group[idx])
                    continue
                contacts.extend(result)
            self.writer.write(contacts, output_file)
            total_contacts += len(contacts)
            print(f"Processing Schools {i + 1}-{i + len(group)}: {len(contacts)} written")
        
        if failed_facilities:
            failed_writer = CsvWriter()
            failed_writer.write(failed_facilities, "failed_facilities.csv")
            print(f"Total failed: {len(failed_facilities)}")
        print(f"Total contacts: {total_contacts}")

class ScraperUrl:
    def __init__(self, ai_model, writer, school_puller):
        self.ai_model = ai_model
        self.writer = writer
        self.school_puller = school_puller

    def _preferred_website(self, current_website, candidate_website):
        current_website = (current_website or "").strip()
        candidate_website = (candidate_website or "").strip()
        if not current_website and candidate_website:
            return candidate_website
        if candidate_website.startswith("https://") and not current_website.startswith("https://"):
            return candidate_website
        if len(candidate_website) > len(current_website):
            return candidate_website
        return current_website

    def _normalize(self, value):
        value = (value or "").strip().lower()
        value = value.replace("&", " and ")
        value = value.replace("st.", "saint")
        value = re.sub(r"\bst\b", "saint", value)
        value = re.sub(r"\bsch\b", "school", value)
        value = re.sub(r"\bjr\b", "junior", value)
        value = re.sub(r"\bsr\b", "senior", value)
        value = re.sub(r",\s*(il|illinois)\b", "", value)
        value = re.sub(r"\billinois\b", "", value)
        value = re.sub(r"[^a-z0-9]+", " ", value)
        return re.sub(r"\s+", " ", value).strip()

    def _facility_key(self, facility_name, city):
        return (
            self._normalize(facility_name),
            self._normalize(city),
        )

    def _dedupe_facilities(self, facilities):
        rows_by_key = OrderedDict()
        for facility in facilities:
            key = self._facility_key(
                facility.get("FacilityName", ""),
                facility.get("City", ""),
            )
            existing = rows_by_key.get(key)
            if existing is None:
                rows_by_key[key] = {
                    "FacilityName": facility.get("FacilityName", ""),
                    "City": facility.get("City", ""),
                    "Website": facility.get("Website", ""),
                }
                continue

            existing["Website"] = self._preferred_website(
                existing.get("Website", ""),
                facility.get("Website", ""),
            )

        deduped = list(rows_by_key.values())
        return deduped, len(facilities) - len(deduped)

    def _progress_file_for(self):
        return "urls_progress.csv"

    def _write_progress(self, processed_facilities, progress_file, completed_keys=None):
        if not processed_facilities:
            return 0

        rows_to_write = []
        seen_in_batch = set()
        for facility in processed_facilities:
            key = self._facility_key(
                facility.get("FacilityName", ""),
                facility.get("City", ""),
            )
            if key in seen_in_batch:
                continue
            if completed_keys is not None and key in completed_keys:
                continue
            rows_to_write.append(
                {
                    "FacilityName": facility.get("FacilityName", ""),
                    "City": facility.get("City", ""),
                    "Website": facility.get("Website", ""),
                }
            )
            seen_in_batch.add(key)

        if not rows_to_write:
            return 0

        headers = ["FacilityName", "City", "Website"]
        with open(progress_file, 'a', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            if f.tell() == 0:
                writer.writeheader()
            writer.writerows(rows_to_write)

        if completed_keys is not None:
            completed_keys.update(seen_in_batch)
        return len(rows_to_write)

    def _dedupe_progress_file(self, progress_file):
        rows_by_key = OrderedDict()
        try:
            with open(progress_file, 'r', newline='', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    key = self._facility_key(
                        row.get("FacilityName", ""),
                        row.get("City", ""),
                    )
                    existing = rows_by_key.get(key)
                    if existing is None:
                        rows_by_key[key] = {
                            "FacilityName": row.get("FacilityName", ""),
                            "City": row.get("City", ""),
                            "Website": row.get("Website", ""),
                        }
                        continue

                    existing["Website"] = self._preferred_website(
                        existing.get("Website", ""),
                        row.get("Website", ""),
                    )
        except FileNotFoundError:
            return 0

        deduped_rows = list(rows_by_key.values())
        headers = ["FacilityName", "City", "Website"]
        with open(progress_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(deduped_rows)
        return len(deduped_rows)

    def _load_completed_from_progress(self, progress_file):
        completed = set()
        try:
            with open(progress_file, 'r', newline='', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    completed.add(self._facility_key(row.get("FacilityName", ""), row.get("City", "")))
        except FileNotFoundError:
            return completed
        return completed

    def _bootstrap_progress_file(self, facilities, completed, progress_file):
        matched = []
        seen = set()
        for facility in facilities:
            facility_key = self._facility_key(
                facility.get("FacilityName", ""),
                facility.get("City", ""),
            )
            if facility_key in completed and facility_key not in seen:
                matched.append(
                    {
                        "FacilityName": facility.get("FacilityName", ""),
                        "City": facility.get("City", ""),
                        "Website": facility.get("Website", ""),
                    }
                )
                seen.add(facility_key)
        headers = ["FacilityName", "City", "Website"]
        with open(progress_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(matched)

    async def scrape_facility(self, facility):
        return await asyncio.wait_for(
            self.ai_model.search(
                facility.get("FacilityName", ""),
                facility.get("City", ""),
                facility.get("Website", ""),
            ),
            timeout=SCRAPE_TIMEOUT_SECONDS,
        )

    async def run(self):
        facilities, dropped_duplicates = self._dedupe_facilities(self.school_puller.get_schools())
        if dropped_duplicates:
            print(f"Deduped input schools: removed {dropped_duplicates} repeated entries")

        progress_file = self._progress_file_for()
        deduped_progress_count = self._dedupe_progress_file(progress_file)
        if deduped_progress_count:
            print(f"Progress file deduped: {deduped_progress_count} unique schools retained")

        completed = self._load_completed_from_progress(progress_file)
        if completed:
            facilities = [
                facility for facility in facilities
                if self._facility_key(
                    facility.get("FacilityName", ""),
                    facility.get("City", ""),
                ) not in completed
            ]
            print(f"Resuming run: skipped {len(completed)} already written schools")

        total_urls = 0
        if not facilities:
            print("No remaining schools to process")
            return
        max_schools = 50
        facilities = facilities[:max_schools]
        print(f"Run limit: processing up to {len(facilities)} schools this run")

        for i in range(0, len(facilities), SCRAPE_BATCH_SIZE):
            group = facilities[i:i + SCRAPE_BATCH_SIZE]
            processes = [self.scrape_facility(f) for f in group]
            scrape_data = await asyncio.gather(*processes, return_exceptions=True)
            urls = []
            processed_facilities = []
            for facility, result in zip(group, scrape_data):
                if isinstance(result, Exception):
                    continue
                processed_facilities.append(
                    {
                        "FacilityName": facility.get("FacilityName", ""),
                        "City": facility.get("City", ""),
                        "Website": facility.get("Website", ""),
                    }
                )
                urls.extend(result)
            written_progress_rows = self._write_progress(
                processed_facilities,
                progress_file,
                completed,
            )
            total_urls += len(urls)
            print(
                f"Processing Schools {i + 1}-{i + len(group)}: "
                f"{written_progress_rows} completed, {len(urls)} URLs written"
            )
        print(f"Total URLs: {total_urls}")


def dedupe_url_rows(input_file, output_file=None):
    output_file = output_file or input_file
    headers = ["School Name", "City", "Homepage"]
    rows_by_key = OrderedDict()

    with open(input_file, 'r', newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            school_name = (row.get("School Name", "") or "").strip()
            city = (row.get("City", "") or "").strip()
            homepage = (row.get("Homepage", "") or "").strip()
            if not school_name and not city and not homepage:
                continue

            key = (
                re.sub(r"\s+", " ", school_name.lower()).strip(),
                re.sub(r"\s+", " ", city.lower()).strip(),
            )
            existing = rows_by_key.get(key)
            if existing is None:
                rows_by_key[key] = {
                    "School Name": school_name,
                    "City": city,
                    "Homepage": homepage,
                }
                continue

            current_homepage = existing.get("Homepage", "")
            if not current_homepage and homepage:
                existing["Homepage"] = homepage
            elif homepage.startswith("https://") and not current_homepage.startswith("https://"):
                existing["Homepage"] = homepage
            elif len(homepage) > len(current_homepage):
                existing["Homepage"] = homepage

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows_by_key.values())

    return len(rows_by_key)

async def main():
    ai_model = GeminiModelUrlFetcher()
    writer = CsvUrlWriter()
    school_puller = JsonSchoolPuller("schools.json")
    scraper = ScraperUrl(ai_model, writer, school_puller)
    while True:
        try:
            print("Starting scheduled scraper run")
            await scraper.run()
        except Exception as exc:
            print(f"Scheduled run failed: {exc}")
        print(f"Next run in {SCRAPE_RUN_INTERVAL_SECONDS // 60} minutes")
        await asyncio.sleep(SCRAPE_RUN_INTERVAL_SECONDS)

if __name__ == "__main__":
    asyncio.run(main())
