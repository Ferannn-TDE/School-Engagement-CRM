import re
import spacy
import json
import os
from abc import ABC, abstractmethod
from urllib.parse import urlparse, urljoin

from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By

EMAIL_REGEX = r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b"
CONTACT_MESSAGE_REGEX = r"(?:send\s*)?message|contact us"
PHONE_REGEX = r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?"
SETTINGS_FILE = "settings.json"


class Scraper(ABC):
    def __init__(self):
        settings_path = os.path.join(os.path.dirname(__file__), SETTINGS_FILE)
        with open(settings_path, "r") as f:
            settings = json.load(f)

        global_values = settings.get("global", {})
        self.search_terms = global_values.get("search_terms", [])
        self.negative_title_terms = global_values.get("negative_title_terms", [])

    @abstractmethod
    def scrape(self, url, driver):
        pass

class NormalReactScraper(Scraper):
    def __init__(self):
        Scraper.__init__(self)
        self.seen_names = set()
        self.failed_page = False

    def fetch_page(self, driver, url):
        try:
            driver.get(url)
            soup = BeautifulSoup(driver.page_source, "html.parser")

            for script in soup(["script", "style"]):
                script.decompose()

            page_text = soup.get_text(" ", strip=True).lower()
            if "404" in page_text:
                return None

            return soup
        except Exception as e:
            # print(f"Error fetching {url}: {e}")
            self.failed_page = True            
            return None

    def extract_block(self, node, min_rows=5):
        if not node:
            return []

        block = node.parent.find_parent(["li", "tr", "div", "section", "article"]) or node.parent
        rows = []

        for _ in range(8):
            if not block:
                break
            rows = [r.strip() for r in block.get_text("\n", strip=True).split("\n") if r.strip()]
            if len(rows) >= min_rows:
                break
            block = block.parent

        return rows

    def scrape(self, url, driver):
        self.failed_page = False
        records = []

        parsed = urlparse(url)
        if not parsed.path or parsed.path == "/":
            return records

        soup = self.fetch_page(driver, url)
        if self.failed_page:
            return None
        if not soup:
            return records
        

        for term in self.search_terms:
            page_url = f"{url}?search={term}"
            soup = self.fetch_page(driver, page_url)
            if self.failed_page:
                return None
            if not soup:
                continue

            records.extend(self.extract_emails(soup))
            records.extend(self.extract_send_messages(soup))

        return records

    def extract_emails(self, soup):
        records = []

        for email in re.findall(EMAIL_REGEX, soup.get_text(" ", strip=True)):
            node = soup.find(string=re.compile(re.escape(email), re.IGNORECASE))
            if not node:
                continue

            rows = self.extract_block(node)
            if len(rows) < 4:
                continue

            if len(rows) >= 5:
                name, title, dept, phone, email_check = rows[0], rows[1], rows[2], rows[3], rows[4]
            else:
                name, title, phone, email_check = rows[0], rows[1], rows[2], rows[3]
                dept = None

            if not re.fullmatch(EMAIL_REGEX, email_check.strip().lower()):
                continue

            title_l = title.lower()
            if any(term in title_l for term in self.negative_title_terms):
                continue

            if name in self.seen_names:
                continue

            if not any(search_term.lower() in title_l for search_term in self.search_terms):
                continue

            self.seen_names.add(name)
            records.append(
                {
                    "name": name,
                    "title": title,
                    "dept": dept,
                    "phone": phone,
                    "email": email.lower(),
                }
            )

        return records

    def extract_send_messages(self, soup):
        records = []

        for contact in soup.find_all(string=re.compile(CONTACT_MESSAGE_REGEX, re.IGNORECASE)):
            rows = self.extract_block(contact)
            if len(rows) < 4:
                continue

            if len(rows) >= 5:
                name, title, dept, phone, _ = rows[0], rows[1], rows[2], rows[3], rows[4]
            else:
                name, title, phone, _ = rows[0], rows[1], rows[2], rows[3]
                dept = None

            title_l = title.lower()
            if any(term in title_l for term in self.negative_title_terms):
                continue

            if name in self.seen_names:
                continue

            if not any(search_term.lower() in title_l for search_term in self.search_terms):
                continue

            self.seen_names.add(name)
            records.append(
                {
                    "name": name,
                    "title": title,
                    "dept": dept,
                    "phone": phone,
                    "email": "Send Message",
                }
            )

        return records


class NLPScraper(Scraper):
    def __init__(self):
        Scraper.__init__(self)
        self.seen_names = set()
        self.email_pattern = re.compile(EMAIL_REGEX)
        self.phone_pattern = re.compile(PHONE_REGEX)
        self.ui_labels = {"titles", "locations"}
        self.nlp = spacy.load("en_core_web_sm")
        self.click_seen_urls = set()
        self.click_depth = 0
        self.failed_page = False

    def fetch_page(self, driver, url):
        try:
            driver.get(url)
            return BeautifulSoup(driver.page_source, "html.parser")
        except Exception as e:
            # print(f"Error fetching {url}: {e}")
            self.failed_page = True
            return None

    def normalize_text(self, text):
        return re.sub(r"\s+", " ", text).strip()

    def split_lines(self, text):
        lines = []
        for raw_line in text.split("\n"):
            line = self.normalize_text(raw_line).strip(" -:\t")
            if line and line.lower() not in self.ui_labels:
                lines.append(line)
        return lines

    def choose_name(self, doc):
        people = []
        for ent in doc.ents:
            if ent.label_ != "PERSON":
                continue
            value = self.normalize_text(ent.text)
            words = [w for w in value.split() if w]
            if len(words) == 2:
                people.append(" ".join(words))

        if not people:
            return None

        people = sorted(set(people), key=lambda v: (len(v.split()), len(v)))
        return people[0]

    def choose_title(self, lines, name, phone, email, name_line_count=1):
        lowered_name = name.lower()

        name_index = None
        for index, line in enumerate(lines):
            if lowered_name in line.lower():
                name_index = index
                break

        if name_index is None:
            name_index = name_line_count - 1

        for line in lines[name_index + 1 : name_index + 3]:
            if phone and phone in line:
                continue
            if email and email in line:
                continue
            if re.search(self.phone_pattern, line):
                continue
            if re.search(self.email_pattern, line):
                continue
            return line

        return None

    def title_matches_filters(self, title):
        if not title:
            return False

        lower = title.lower()

        for neg in sorted(self.negative_title_terms, key=len, reverse=True):
            if re.search(rf"\b{re.escape(neg)}\b", lower):
                return False

        for term in sorted(self.search_terms, key=len, reverse=True):
            if re.search(rf"\b{re.escape(term)}\b", lower):
                return True

        return False

    def build_contact_from_parent(self, parent):
        parent_text = parent.get_text("\n", strip=True)
        lines = self.split_lines(parent_text)
        if not lines:
            return None

        phone_match = re.search(self.phone_pattern, parent_text)
        email_match = re.search(self.email_pattern, parent_text)

        if not phone_match and not email_match:
            return None

        phone = phone_match.group(0) if phone_match else None
        email = email_match.group(0) if email_match else None

        doc = self.nlp(parent_text)
        name = self.choose_name(doc)
        name_line_count = 1
        if not name and lines:
            if len(lines[0].split()) == 1 and len(lines) > 1:
                name = f"{lines[0]} {lines[1]}"
                name_line_count = 2
            else:
                name = lines[0]
        if not name:
            return None

        title = self.choose_title(lines, name, phone, email, name_line_count)

        return {
            "name": name,
            "title": title,
            "phone": phone,
            "email": email,
        }

    def fetch_pages(self, driver, url, max_pages=20):
        soups = []
        queue = [url]
        visited = set()

        while queue and len(visited) < max_pages:
            current_url = queue.pop(0)
            if current_url in visited:
                continue

            visited.add(current_url)
            soup = self.fetch_page(driver, current_url)
            if not soup:
                continue

            soups.append(soup)
            resolved_current = driver.current_url or current_url

            pagination_links = []
            pagination_links.extend(
                soup.select(
                    "a[rel='next'], a[aria-label*='next' i], a.next, li.next a, .pagination a, nav[aria-label*='pagination' i] a"
                )
            )

            for anchor in soup.select("a"):
                text = anchor.get_text(" ", strip=True)
                rel = " ".join(anchor.get("rel", []))
                if text.isdigit() or "next" in rel.lower() or text.lower() == "next":
                    pagination_links.append(anchor)

            for anchor in pagination_links:
                href = (anchor.get("href") or "").strip()
                if not href or href.startswith("#") or href.lower().startswith("javascript:"):
                    continue

                next_url = urljoin(resolved_current, href)
                if next_url not in visited and next_url not in queue:
                    queue.append(next_url)

        return soups

    def scrape(self, url, driver):
        self.failed_page = False
        records = []
        top_level = self.click_depth == 0
        if top_level:
            self.click_seen_urls = set()

        soups = self.fetch_pages(driver, url)
        if self.failed_page:
            return None
        if not soups:
            return records

        for soup in soups:
            containers = set()
            matches = set()

            matches.update(soup.select('a[href^="mailto:"]'))
            matches.update(soup.select('a[href^="tel:"]'))
            matches.update(a for a in soup.find_all("a") if "send message" in a.get_text(strip=True).lower())
            matches.update(a for a in soup.find_all("a") if "email" in a.get_text(strip=True).lower())
            matches.update(a for a in soup.find_all("a") if "message" in a.get_text(strip=True).lower())
            matches.update(t.parent for t in soup.find_all(string=self.email_pattern))
            matches.update(t.parent for t in soup.find_all(string=self.phone_pattern))
            matches.update(a for a in soup.find_all("a") if "/sys/user/email" in (a.get("onclick") or ""))

            for match in matches:
                candidate = match
                for _ in range(8):
                    candidate = candidate.parent
                    if not candidate:
                        break

                    text = candidate.get_text(" ", strip=True)

                    if text:
                        doc = self.nlp(text)
                        has_person = any(
                            ent.label_ == "PERSON"
                            and not re.search(r"\b(?:email|send|message|phone|tel|fax|ext|extension)\b", ent.text, re.I)
                            and not re.search(r"\d", ent.text)
                            for ent in doc.ents
                        )

                        if has_person or candidate.find("img"):
                            containers.add(candidate)
                            break

            match_counts = {
                c: sum(c != other and c.get("class") == other.get("class") for other in containers)
                for c in containers
            }

            best_count = max(match_counts.values(), default=0)
            containers = {c for c in containers if match_counts[c] == best_count and best_count > 0}

            for container in containers:
                contact = self.build_contact_from_parent(container)

                if not contact:
                    continue

                if not self.title_matches_filters(contact["title"]):
                    continue

                if contact["name"] in self.seen_names:
                    continue

                self.seen_names.add(contact["name"])
                records.append(
                    {
                        "name": contact["name"],
                        "title": contact["title"],
                        "phone": contact["phone"],
                        "email": contact["email"],
                    }
                )

        if records and self.click_depth < 2:
            self.click_depth += 1
            try:
                current_url = driver.current_url or url
                self.click_seen_urls.add(current_url)
                for page_num in range(2, 8):
                    try:
                        if page_num >= 2:
                            print(f" Pagination: {page_num}")
                        page_link = driver.find_element(By.XPATH, f"//a[normalize-space(text())='{page_num}']")
                        page_link.click()
                        opened_url = driver.current_url
                        if opened_url in self.click_seen_urls:
                            continue
                        self.click_seen_urls.add(opened_url)
                        records.extend(self.scrape(opened_url, driver))
                    except Exception:
                        continue
            finally:
                self.click_depth -= 1

        return records


class ScraperContext:
    def __init__(self, driver):
        self.driver = driver
        self.primary_scraper = NormalReactScraper()
        self.fallback_scraper = NLPScraper()

    def scrape_school(self, school, alt_urls_config, contact_paths):
        all_records = []
        urls = self.build_urls(school, alt_urls_config, contact_paths)

        base_url = (school.get("Website") or "").strip()
        school_config = alt_urls_config.get(school["FacilityName"], {})
        alt_urls_list = school_config.get("alt_urls", [])
        contacts_urls_list = school_config.get("contacts_url", [])
        alt_url = alt_urls_list[0].strip() if alt_urls_list else ""
        contacts_url = contacts_urls_list[0].strip() if contacts_urls_list else ""

        pages_with_contacts = set()

        self.primary_scraper.seen_names = set()
        for url in urls[1:]:
            per_url_records = self.primary_scraper.scrape(url, self.driver)
            if per_url_records is None:
                break

            if per_url_records:
                pages_with_contacts.add(url)

            all_records.extend(per_url_records)

        if not all_records:
            self.fallback_scraper.seen_names = set()
            for url in urls[1:]:
                per_url_records = self.fallback_scraper.scrape(url, self.driver)
                if per_url_records is None:
                    break

                if per_url_records:
                    pages_with_contacts.add(url)

                all_records.extend(per_url_records)

        return {
            "records": all_records,
            "school_urls": {
                "base_url": base_url,
                "contacts_url": contacts_url or None,
                "alt_url": alt_url or None,
                "pages_with_contacts": sorted(pages_with_contacts),
            },
        }

    def build_urls(self, school, alt_urls_config, contact_paths):
        base_website = (school.get("Website") or "").strip()
        urls = [base_website] if base_website else []

        school_config = alt_urls_config.get(school["FacilityName"], {})
        alt_urls_list = school_config.get("alt_urls", [])
        contacts_urls_list = school_config.get("contacts_url", [])

        contacts_url = contacts_urls_list[0].strip() if contacts_urls_list else ""
        alt_url = alt_urls_list[0].strip() if alt_urls_list else ""

        expanded_urls = list(urls)

        if contacts_url and contacts_url not in expanded_urls:
            expanded_urls.append(contacts_url)

        if alt_url:
            for path in contact_paths:
                candidate = alt_url.rstrip("/") + path
                if candidate not in expanded_urls:
                    expanded_urls.append(candidate)

        if base_website:
            for path in contact_paths:
                candidate = base_website.rstrip("/") + path
                if candidate not in expanded_urls:
                    expanded_urls.append(candidate)

        return expanded_urls
