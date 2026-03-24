import re
import spacy
import json
from abc import ABC, abstractmethod
from urllib.parse import urljoin
from collections import Counter

from bs4 import BeautifulSoup


SETTINGS_FILE = "settings.json"

class Scraper(ABC):
    def __init__(self, selenium):
        self.selenium = selenium

    @abstractmethod
    def scrape(self, url, selenium):
        pass

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
                if text.isdigit() or text.lower() == "next":
                    pagination_links.append(anchor)

            for anchor in pagination_links:
                href = (anchor.get("href") or "").strip() if anchor and hasattr(anchor, "get") else ""
                if not href or href.startswith("#"):
                    continue
                next_url = urljoin(resolved_current, href)
                if next_url not in visited and next_url not in queue:
                    queue.append(next_url)

        return soups



    

    


class NLPScraper(Scraper):
    def __init__(self, selenium):
        Scraper.__init__(self, selenium)
        with open(SETTINGS_FILE, "r") as f:
            self.settings = json.load(f)
        
        self.global_values = self.settings.get("global")
        self.search_terms = self.global_values.get("search_terms")
        self.negative_title_terms = self.global_values.get("negative_title_terms")
        
        self.email_regex = re.compile(self.global_values.get("EMAIL_REGEX"))
        self.message_regex = re.compile(self.global_values.get("MESSAGE_REGEX"))
        self.phone_regex = re.compile(self.global_values.get("PHONE_REGEX"))
        self.nlp = spacy.load("en_core_web_sm")
        self.majority_class = None

   
    
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
            return False
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
        
    def normalize_contact(self, contact):
        name = contact.get("name")
        title = contact.get("title")
        phone = contact.get("phone")
        email = contact.get("email")
        return {
            "name": contact.get("name", "").strip().lower()if name else "",
            "title": contact.get("title", "").strip().lower() if title else "",
            "phone": contact.get("phone", "").strip() if phone else "",
            "email": contact.get("email", "").strip().lower() if email else "",
        }


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



class NormalReactScraper(Scraper):
    def __init__(self, selenium):
        Scraper.__init__(self, selenium)
        with open(SETTINGS_FILE, "r") as f:
            self.settings = json.load(f)
        
        self.global_values = self.settings.get("global")
        self.search_terms = self.global_values.get("search_terms")
        self.negative_title_terms = self.global_values.get("negative_title_terms")
        
        self.email_regex = re.compile(self.global_values.get("EMAIL_REGEX"))
        self.message_regex = re.compile(self.global_values.get("MESSAGE_REGEX"), re.IGNORECASE)
        self.phone_regex = re.compile(self.global_values.get("PHONE_REGEX"))
        self.sendto_regex = re.compile(r"sendto:", re.IGNORECASE)
        self.mailto_regex = re.compile(r"mailto:", re.IGNORECASE)

    def normalize_contact(self, contact):
        name = contact.get("name")
        title = contact.get("title")
        dept = contact.get("dept")
        phone = contact.get("phone")
        email = contact.get("email")
        return {
            "name": contact.get("name", "").strip().lower() if name else "",
            "title": contact.get("title", "").strip().lower()if title else "",
            "dept": contact.get("dept", "").strip().lower() if dept else "",
            "phone": contact.get("phone", "").strip() if phone else "",
            "email": contact.get("email", "").strip().lower() if email else "",
        }

    def scrape(self, url, selenium):
        records = []
        unique_records = set()
        deduped_records = []
        soups = self.fetch_pages(selenium, url)
        if not soups:
            return records

        for soup in soups:
            records.extend(self.extract_emails(soup))

        for record in records:
            normalized_contact = self.normalize_contact(record)
            contact_tuple = tuple(normalized_contact.items())
            if contact_tuple not in unique_records:
                unique_records.add(contact_tuple)
                deduped_records.append(record)
            
        return deduped_records
    

    def extract_block(self, contact):
        if contact is None:
            return []

        node = contact
        if not hasattr(node, "name"):
            node = getattr(contact, "parent", None)

        if node is None:
            return []

        tags = ["li", "tr", "div", "section", "article", "td"]
        best_rows = []

        for _ in range(8):
            if node is None:
                break

            text = node.get_text("\n", strip=True) if hasattr(node, "get_text") else ""
            raw_rows = text.split("\n") if text else []

            cleaned = []
            for r in raw_rows:
                row = (r or "").strip()
                if not row:
                    continue
                low = row.lower()
                if self.message_regex.search(low):
                    continue
                if low.startswith("to "):
                    continue
                cleaned.append(row)

            if 2 <= len(cleaned) <= 10:
                best_rows = cleaned
                has_email = any(re.search(self.email_regex, x) for x in cleaned)
                has_phone = any(re.search(self.phone_regex, x) for x in cleaned)
                has_title = any(
                    any(term.lower() in x.lower() for term in self.search_terms)
                    for x in cleaned
                )
                if has_email or has_phone or has_title:
                    break

            node = node.find_parent(tags)

        return best_rows
    

    def normalize_text(self, value):
        if not value:
            return ""
        v = re.sub(r"\s+", " ", str(value)).strip()
        parts = v.split(" ")
        out = []
        for p in parts:
            if not p:
                continue
            out.append(p[:1].upper() + p[1:].lower())
        return " ".join(out)
    

    def extract_emails(self, soup):
        if soup is None:
            return []

        records = []
        results = []
        seen_names = set()

        results.extend(soup.find_all(string=self.email_regex))
        results.extend(soup.find_all(string=self.message_regex))
        results.extend(soup.find_all("a", href=self.sendto_regex))
        results.extend(soup.find_all("a", href=self.mailto_regex))

        for a in soup.find_all("a"):
            txt = a.get_text(" ", strip=True) if hasattr(a, "get_text") else ""
            if self.message_regex.search(txt or ""):
                results.append(a)

        for b in soup.find_all("button"):
            txt = b.get_text(" ", strip=True) if hasattr(b, "get_text") else ""
            if self.message_regex.search(txt or ""):
                results.append(b)

    

        for contact in results:
            email_from_link = ""
            node = contact if hasattr(contact, "name") else getattr(contact, "parent", None)

            if node is not None and hasattr(node, "get"):
                href = (node.get("href") or "").strip()
                if href.lower().startswith("mailto:") or href.lower().startswith("sendto:"):
                    email_from_link = href.split(":", 1)[-1].split("?", 1)[0].strip()

            if not email_from_link and isinstance(contact, str):
                m = re.search(self.email_regex, contact)
                if m:
                    email_from_link = m.group(0).strip()

            rows = self.extract_block(node if node is not None else contact)
            if len(rows) < 2:
                continue

            card_key = tuple(rows)
            if card_key in seen_names:
                continue
            seen_names.add(card_key)

            name = ""
            title = ""
            dept = ""
            phone = ""
            email = ""

            for row in rows:
                low = row.lower()

                if not email:
                    m = re.search(self.email_regex, row)
                    if m:
                        email = m.group(0)
                        continue

                if not phone:
                    m = re.search(self.phone_regex, row)
                    if m:
                        phone = m.group(0)
                        continue

                if not title:
                    has_search = any(term.lower() in low for term in self.search_terms)
                    has_neg = any(term in low for term in self.negative_title_terms)
                    if has_search and not has_neg:
                        title = row
                        continue

                if not name:
                    is_noise = self.message_regex.search(low) is not None
                    is_phone = re.search(self.phone_regex, row) is not None
                    is_email = re.search(self.email_regex, row) is not None
                    if not is_noise and not is_phone and not is_email:
                        name = row

            for row in rows:
                if row == name or row == title:
                    continue
                if re.search(self.phone_regex, row):
                    continue
                if re.search(self.email_regex, row):
                    continue
                if self.message_regex.search(row.lower()):
                    continue
                dept = row
                break

            if not email and email_from_link:
                email = email_from_link

            if not title:
                continue

            record = {
                "name": self.normalize_text(name),
                "title": self.normalize_text(title),
                "dept": self.normalize_text(dept),
                "phone": (phone or "").strip(),
                "email": (email or "").strip().lower(),
            }

            records.append(record)

        return records
    
    


class ScraperContext:
    def __init__(self, selenium):
        self.selenium = selenium
        
        self.nlp_Scraper = NLPScraper(self.selenium)
        self.normalReactScraper = NormalReactScraper(self.selenium)

    def build_urls(self, contact_paths, base_url):
        links = []
        for path in contact_paths:
            candidate = base_url.rstrip("/") + path
            if candidate not in links:
                links.append(candidate)
        
        return links
    
    def scrape_school(self, school, contact_paths, base_url):
        all_records = []
        fin_records = []
        dedupl_records = set()
        urls = self.build_urls(contact_paths, base_url)
        pages_with_contacts = set()
        for url in urls:
            records = self.normalReactScraper.scrape(url, self.selenium)
            if records is None:
                break
            if records:
                # print("React Scraper")
                pages_with_contacts.add(url)
            all_records.extend(records)
        
        if all_records:
            for record in all_records:
                normalized_contact = self.normalReactScraper.normalize_contact(record)
                contact_tuple = tuple(normalized_contact.items())
                if contact_tuple not in dedupl_records:
                    dedupl_records.add(contact_tuple)
                    fin_records.append(record)

        if not all_records:
            urls = self.build_urls(contact_paths, base_url)
            pages_with_contacts = set()
            for url in urls:
                records = self.nlp_Scraper.scrape(url, self.selenium)
                if records is None:
                    break
                if records:
                    # print("NLP Scraper")
                    pages_with_contacts.add(url)
                all_records.extend(records)

            for record in all_records:
                normalized_contact = self.nlp_Scraper.normalize_contact(record)
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