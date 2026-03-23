import re
import spacy
import json
from abc import ABC, abstractmethod
from urllib.parse import urljoin
from collections import Counter

from bs4 import BeautifulSoup


SETTINGS_FILE = "settings.json"

class Scraper:
    def __init__(self, selenium):
        self.selenium = selenium
        self.nlp_Scraper = NLPScraper()

    def scrape_school(self, school, contact_paths, base_url):
        all_records = []
        fin_records = []
        dedupl_records = set()
        urls = self.build_urls(contact_paths, base_url)
        pages_with_contacts = set()
        for url in urls:
            records = self.nlp_Scraper.scrape(url, self.selenium)
            if records is None:
                break
            if records:
                pages_with_contacts.add(url)
            all_records.extend(records)

        if not all_records:
            urls = self.build_urls(contact_paths, base_url)
            pages_with_contacts = set()
            for url in urls:
                records = self.nlp_Scraper.scrape(url, self.selenium)
                if records is None:
                    break
                if records:
                    pages_with_contacts.add(url)
                all_records.extend(records)
        
        for record in all_records:
            normalized_contact = self.normalize_contact(record)
            contact_tuple = tuple(normalized_contact.items())
            if contact_tuple not in dedupl_records:
                dedupl_records.add(contact_tuple)
                fin_records.append(record)


        return {
            "records": fin_records,
            "school_urls": {
                "base_url": base_url or None,
                "pages_with_contacts": sorted(pages_with_contacts),
            },
        }
    
    def normalize_contact(self, contact):
        return {
            "name": contact.get("name", "").strip().lower(),
            "title": contact.get("title", "").strip().lower(),
            "phone": contact.get("phone", "").strip() if contact.get("phone") else "",
            "email": contact.get("email", "").strip().lower(),
        }

    def build_urls(self, contact_paths, base_url):
        links = []
        for path in contact_paths:
            candidate = base_url.rstrip("/") + path
            if candidate not in links:
                links.append(candidate)
        
        return links


class NLPScraper():
    def __init__(self):
        with open(SETTINGS_FILE, "r") as f:
            settings = json.load(f)
        
        global_values = settings.get("global")
        self.search_terms = global_values.get("search_terms")
        self.negative_title_terms = global_values.get("negative_title_terms")

        self.email_regex = re.compile(global_values.get("EMAIL_REGEX"))
        self.message_regex = re.compile(global_values.get("MESSAGE_REGEX"))
        self.phone_regex = re.compile(global_values.get("PHONE_REGEX"))
        
        self.nlp = spacy.load("en_core_web_sm")
        self.majority_class = None

    def fetch_page(self, selenium, url):
        try:
            selenium.get(url)
            return BeautifulSoup(selenium.page_source, "html.parser")
        except Exception as e:
            return None

    def fetch_pages(self, selenium, url):
        soups = []
        queue = [url]
        visited = set()

        while queue and len(visited) < 20:
            current_url = queue.pop()
            if current_url in visited:
                continue
            visited.add(current_url)
            soup = self.fetch_page(selenium, current_url)
            if not soup:
                continue
            soups.append(soup)

            resolved_current = selenium.current_url or current_url
            
            pagination_links = []
            pagination_links.extend(soup.select("a[rel='next'], a[aria-label*='next' i], a.next, li.next a, .pagination a, nav[aria-label*='pagination' i] a"))

            for anchor in soup.select("a"):
                text = anchor.get_text(" ", strip=True)
                if text.isdigit or text.lower() == "next":
                    pagination_links.append(anchor)

            for anchor in pagination_links:
                href = (anchor.get("href") or "").strip() if anchor and hasattr(anchor, "get") else ""
                if not href or href.startswith("#"):
                    continue
                next_url = urljoin(resolved_current, href)
                if next_url not in visited and next_url not in queue:
                    queue.append(next_url)
            return soups
    
    def name_or_image(self, node):
        if node is None:
            return False
        text = node.get_text(" ", strip=True)
        if not text:
            return False
        ignore_terms = ["email", "send", "message", "phone", "tel", "fax", "ext", "extension"]
        for term in ignore_terms:
            text = text.replace(term, "")
        doc = self.nlp(text)
        has_person = any(
            ent.label_ == "PERSON" and not any(c.isdigit() for c in ent.text)
            for ent in doc.ents
        )
        has_image = node.find("img") is not None
        return has_person or has_image
    

    def split_lines(self, text):
        lines = []
        removes = ["title", "dept"]
        for line in text.split("\n"):
            line = re.sub(r"\s+", " ", line or "").strip(" -:\t")
            words = line.split()
            words = [word for word in words if word.lower() not in removes]
            if words:
                lines.append(" ".join(words))
        return lines
    
    def extract_email_link(self, matched_anchor):
        if matched_anchor and hasattr(matched_anchor, "get"):
            href = matched_anchor.get("href")
            onclick = matched_anchor.get("onclick")
            text = matched_anchor.get_text(" ", strip=True) if hasattr(matched_anchor, "get_text") else ""
            href = (href or "").strip() if href else ""
            onclick = (onclick or "").strip() if onclick else ""
            if href.lower().startswith("mailto:"):
                email = href.replace("mailto:", "").split("?", 1)[0].strip()
                return email, href
            if href and self.message_regex.search(text):
                return None, href
            if onclick and re.search(r"/sys/user/email", onclick, re.I):
                return None, onclick
        return None, None

    def choose_name(self, doc):
        people = []
        for ent in doc.ents:
            if ent.label_ != "PERSON":
                continue
            value = re.sub(r"\s+", " ", ent.text or "").strip(" -:\t")
            words = [w for w in value.split() if w]
            if len(words) == 2:
                people.append(" ".join(words))
            elif len(words) > 2:
                people.append(" ".join(words[:2]))
        if not people:
            return None
        people = sorted(set(people), key=len)
        return people[0]

    def title_matcher(self, line):
        if not line:
            return
        False
        lower = line.lower()
        if any(re.search(rf"\b{re.escape(neg)}\b", lower) for neg in self.negative_title_terms):
            return False
        if any(re.search(rf"\b{re.escape(term)}\b", lower) for term in self.search_terms):
            return True
        return False



    def choose_title(self,lines,name,phone,email):
        lowered_name = name.lower()
        name_index = None
        for index, line in enumerate(lines):
            if lowered_name in line.lower():
                name_index = index
                break
        if name_index is None:
            return None
        
        name_parts = lines[name_index].split()
        if len(name_parts) > 2:
            lines[name_index] = " ".join(name_parts[:2])
            lines.insert(name_index + 1, " ".join(name_parts[2:]))
        for line in lines[name_index + 1 : name_index + 4]:
            if phone and phone in line:
                continue
            if email and email in line:
                continue
            if re.search(self.phone_regex, line):
                continue
            if re.search(self.email_regex, line):
                continue
            if self.title_matcher(line):
                return line
        return None
        


    def build_contact(self, container, sig, matched_anchor=None):
        container_text = container.get_text("\n", strip=True) if container and hasattr(container, "get_text") else ""
        lines = self.split_lines(container_text)
        if not lines:
            return None
        
        phone_match = re.search(self.phone_regex, container_text)
        email_match = re.search(self.email_regex, container_text)
        phone = phone_match.group(0) if phone_match else None
        email_text = email_match.group(0) if email_match else None

        email_with_link, email_link = self.extract_email_link(matched_anchor)
        email = email_text or email_with_link
        if not email and email_link:
            email = email_link

        doc = self.nlp(container_text)
        name = self.choose_name(doc)
        if not name:
            name = " ".join(re.sub(r"\s+", " ", lines[0]).strip(" -:\t").split()[:2])
        title = self.choose_title(lines, name, phone, email)

        return {
            "name": name,
            "title": title,
            "phone": phone,
            "email": email,
        }



    def normalize_contact(self, contact):
        return {
            "name": contact.get("name" or "").strip().lower(),
            "title": contact.get("title" or "").strip().lower(),
            "phone": contact.get("phone" or "").strip() if contact.get("phone") else "",
            "email": contact.get("email" or "").strip().lower(),
        }
    
    
    def scrape(self, url, selenium):
        records = []
        unique_records = set()
        soups = self.fetch_pages(selenium, url)
        if not soups:
            return records
        
        for soup in soups:
            matches = set()
            matches.update(t.parent for t in soup.find_all(string=self.email_regex))
            matches.update(soup.select('a[href^="mailto:"]'))
            matches.update(a for a in soup.find_all("a") if re.search(self.message_regex, a.get_text(strip=True).lower()))
            matches.update(a for a in soup.find_all("a") if re.search(self.message_regex, a.get("onclick") or ""))
            matches.update(element for element in soup.find_all(string=True)if re.search(self.message_regex, element.strip().lower()))


            candidate_pairs = []
            for match in matches:
                matched_anchor = match
                for _ in range(8):
                    if match is None:
                        break
                    match = match.parent
                    if not self.name_or_image(match):
                        continue
                    if match.name in ("html", "[document]", None) or (match.name in ("p",) and not match.get("class")):
                        continue

                    candidate_pairs.append((match, matched_anchor, tuple(sorted(match.get("class", [])))))
                    break
            if not candidate_pairs:
                continue

            if self.majority_class is None and len(candidate_pairs) >= 5:
                counts = Counter(sig for _,_,sig in candidate_pairs if sig)
                if counts:
                    top2 = tuple(sig for sig,_ in counts.most_common(2))
                    self.majority_class = top2
            
            page_winners = {}
            for container, matched_anchor, sig in candidate_pairs:
                if self.majority_class and sig not in self.majority_class:
                    continue
                page_winners[id(container)] = (container, matched_anchor, sig)


            if self.majority_class:
                for node in soup.find_all(True):
                    parsed_node = tuple(sorted(node.get("class", [])))
                    if parsed_node not in self.majority_class:
                        continue
                    if id(node) in page_winners:
                        continue
                    anchor = node.select_one('a[href^="mailto:"], a[href^="tel:"], a[onclick*="/sys/user/email"], a')
                    parsed_node = tuple(sorted(node.get("class", [])))
                    page_winners[id(node)] = (node, anchor, parsed_node)

            for container, matched_anchor, sig in page_winners.values():
                contact = self.build_contact(container, sig, matched_anchor)
                
                if not contact:
                    continue
                
                
                if contact.get("title"):
                    normalized_contact = self.normalize_contact(contact)
                    contact_tuple = tuple(normalized_contact.items())
                    if contact_tuple not in unique_records:
                        unique_records.add(contact_tuple)
                        records.append(contact)

        return records

