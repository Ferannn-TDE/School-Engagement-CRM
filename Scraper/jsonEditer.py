import csv
import json
from pathlib import Path


SETTINGS_PATH = Path("settings.json")
COMPLETED_PATH = Path("Completed.json")
STILL_WORKING_PATH = Path("StillWorking.json")
SCHOOLS_PATH = Path("schools.json")


def load_json(path):
    text = path.read_text(encoding="utf-8-sig")
    return json.loads(text)


def save_json(path, data):
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def ensure_settings_shape(data):
    if "global" not in data or not isinstance(data["global"], dict):
        data["global"] = {}
    if "school_rules" not in data or not isinstance(data["school_rules"], dict):
        data["school_rules"] = {}
    return data


def normalize_urls(urls):
    seen = set()
    out = []
    for url in urls:
        clean = str(url or "").strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def input_path(prompt, default=None):
    raw = input(prompt).strip().strip('"')
    if not raw:
        return default if default is not None else Path()
    return Path(raw)


def input_urls(prompt):
    raw = input(prompt).strip()
    if not raw:
        return []
    return normalize_urls(raw.split(","))


def load_result_map(path):
    if not path.exists():
        return {}

    data = load_json(path)
    if not isinstance(data, dict):
        print(f"Expected a JSON object in {path}")
        return {}

    return data


def load_combined_results(completed_path, still_working_path):
    completed = load_result_map(completed_path)
    still_working = load_result_map(still_working_path)

    combined = dict(still_working)
    combined.update(completed)
    return completed, still_working, combined


def build_school_name_index_map(path):
    if not path.exists():
        return {}

    data = load_json(path)
    if not isinstance(data, list):
        return {}

    index_map = {}
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        name = str(item.get("FacilityName") or "").strip()
        if not name:
            continue
        index_map.setdefault(name, []).append(idx)

    return index_map


def result_payload_to_school_item(school_name, payload):
    if not isinstance(payload, dict):
        payload = {}

    school_urls = payload.get("school_urls", {})
    if not isinstance(school_urls, dict):
        school_urls = {}

    contacts = payload.get("contacts", [])
    if not isinstance(contacts, list):
        contacts = []

    pages_with_contacts = school_urls.get("pages_with_contacts", [])
    if not isinstance(pages_with_contacts, list):
        pages_with_contacts = []

    return {
        "SchoolName": school_name,
        "BaseUrl": school_urls.get("base_url"),
        "AltUrl": school_urls.get("alt_url"),
        "PagesWithContacts": pages_with_contacts,
        "ContactCount": len(contacts),
        "Error": payload.get("error"),
    }


def setting_rule_to_school_item(school_name, rule):
    urls = rule.get("alt_urls", []) if isinstance(rule, dict) else []
    urls = normalize_urls(urls)

    return {
        "SchoolName": school_name,
        "BaseUrl": None,
        "AltUrl": urls[0] if urls else None,
        "PagesWithContacts": [],
        "ContactCount": 0,
        "Error": None,
    }


def school_name_from_item(item):
    if not isinstance(item, dict):
        return None

    for key in ["SchoolName", "FacilityName", "school"]:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def alt_urls_from_payload(payload):
    if not isinstance(payload, dict):
        return []

    if "alt_urls" in payload and isinstance(payload["alt_urls"], list):
        return normalize_urls(payload["alt_urls"])

    school_urls = payload.get("school_urls", {})
    if isinstance(school_urls, dict):
        return normalize_urls([school_urls.get("alt_url")])

    if "AltUrl" in payload:
        return normalize_urls([payload.get("AltUrl")])

    if "alt_url" in payload:
        return normalize_urls([payload.get("alt_url")])

    return []


def extract_school_rules_from_any_json(data):
    if isinstance(data, dict) and "school_rules" in data and isinstance(data["school_rules"], dict):
        out = {}
        for school, rule in data["school_rules"].items():
            out[school] = {"alt_urls": alt_urls_from_payload(rule)}
        return out

    if isinstance(data, dict):
        out = {}
        for school, payload in data.items():
            if isinstance(school, str) and school.strip():
                out[school] = {"alt_urls": alt_urls_from_payload(payload)}
        return out

    if isinstance(data, list):
        out = {}
        for item in data:
            school_name = school_name_from_item(item)
            if school_name:
                out[school_name] = {"alt_urls": alt_urls_from_payload(item)}
        return out

    return {}


def extract_school_names_from_any_json(data):
    if isinstance(data, dict) and "school_rules" in data and isinstance(data["school_rules"], dict):
        return set(data["school_rules"].keys())

    if isinstance(data, dict) and "matches" in data and isinstance(data["matches"], list):
        names = set()
        for item in data["matches"]:
            if isinstance(item, dict):
                school = item.get("school")
                if isinstance(school, str) and school.strip():
                    names.add(school.strip())
        return names

    if isinstance(data, dict):
        return {key for key in data.keys() if isinstance(key, str) and key.strip()}

    if isinstance(data, list):
        names = set()
        for item in data:
            school_name = school_name_from_item(item)
            if school_name:
                names.add(school_name)
        return names

    return set()


def name_key(name):
    return str(name or "").strip().lower()


def has_staff_page(record):
    pages = record.get("PagesWithContacts", [])
    return isinstance(pages, list) and bool(pages)


def build_school_catalog(settings, completed=None, still_working=None):
    catalog = {}

    for school in sorted(settings["school_rules"].keys()):
        rule = settings["school_rules"].get(school, {})
        catalog[name_key(school)] = setting_rule_to_school_item(school, rule)

    for source in [still_working or {}, completed or {}]:
        for school_name, payload in source.items():
            if not isinstance(school_name, str) or not school_name.strip():
                continue

            key = name_key(school_name)
            incoming = result_payload_to_school_item(school_name, payload)

            if key not in catalog:
                catalog[key] = incoming
                continue

            current = catalog[key]
            for field in ["BaseUrl", "AltUrl", "PagesWithContacts", "ContactCount", "Error"]:
                value = incoming.get(field)
                if field == "PagesWithContacts":
                    if value:
                        current[field] = value
                elif field == "ContactCount":
                    if value:
                        current[field] = value
                elif value is not None and str(value).strip():
                    current[field] = value

    return sorted(catalog.values(), key=lambda x: str(x.get("SchoolName") or "").lower())


def count_no_results():
    completed_path = input_path(
        f"Path to Completed JSON (default: {COMPLETED_PATH}): ",
        COMPLETED_PATH,
    )
    still_working_path = input_path(
        f"Path to StillWorking JSON (default: {STILL_WORKING_PATH}): ",
        STILL_WORKING_PATH,
    )

    _, _, combined = load_combined_results(completed_path, still_working_path)

    no_results = []
    missing_website = []

    for school_name, payload in combined.items():
        item = result_payload_to_school_item(school_name, payload)
        if item.get("Error") == "missing website":
            missing_website.append(item)
        elif item.get("ContactCount", 0) == 0:
            no_results.append(item)

    print(f"Total schools loaded: {len(combined)}")
    print(f"No-contact schools: {len(no_results)}")
    print(f"Missing-website schools: {len(missing_website)}")


def count_with_results():
    completed_path = input_path(
        f"Path to Completed JSON (default: {COMPLETED_PATH}): ",
        COMPLETED_PATH,
    )
    still_working_path = input_path(
        f"Path to StillWorking JSON (default: {STILL_WORKING_PATH}): ",
        STILL_WORKING_PATH,
    )

    _, _, combined = load_combined_results(completed_path, still_working_path)

    with_contacts = []
    missing_website = []

    for school_name, payload in combined.items():
        item = result_payload_to_school_item(school_name, payload)
        if item.get("Error") == "missing website":
            missing_website.append(item)
        elif item.get("ContactCount", 0) > 0:
            with_contacts.append(item)

    print(f"Total schools loaded: {len(combined)}")
    print(f"Schools with contacts: {len(with_contacts)}")
    print(f"Missing-website schools: {len(missing_website)}")


def export_list_types_json(settings):
    print("\nExport List Types")
    print("1) From Completed + StillWorking: schools with no contacts")
    print("2) From Completed + StillWorking: schools with contacts")
    print("3) From Completed + StillWorking: schools with no staff page found")
    print("4) From settings.json: schools with empty alt_urls")
    print("5) From settings.json + results: all school names")
    choice = input("Choose export type: ").strip()

    output_path = input_path("Output JSON path: ", Path("export.json"))

    if choice in {"1", "2", "3", "5"}:
        completed_path = input_path(
            f"Path to Completed JSON (default: {COMPLETED_PATH}): ",
            COMPLETED_PATH,
        )
        still_working_path = input_path(
            f"Path to StillWorking JSON (default: {STILL_WORKING_PATH}): ",
            STILL_WORKING_PATH,
        )
        completed, still_working, combined = load_combined_results(completed_path, still_working_path)

        if choice == "1":
            records = []
            for school_name, payload in combined.items():
                item = result_payload_to_school_item(school_name, payload)
                if item["ContactCount"] == 0:
                    records.append(item)

        elif choice == "2":
            records = []
            for school_name, payload in combined.items():
                item = result_payload_to_school_item(school_name, payload)
                if item["ContactCount"] > 0:
                    records.append(item)

        elif choice == "3":
            records = []
            for school_name, payload in combined.items():
                item = result_payload_to_school_item(school_name, payload)
                if not item["PagesWithContacts"]:
                    records.append(item)

        else:
            records = build_school_catalog(settings, completed, still_working)

        save_json(output_path, records)
        print(f"Exported {len(records)} records to {output_path}")
        return

    if choice == "4":
        records = []
        for school, rule in settings["school_rules"].items():
            urls = rule.get("alt_urls", []) if isinstance(rule, dict) else []
            if not urls:
                records.append(setting_rule_to_school_item(school, rule))
        save_json(output_path, records)
        print(f"Exported {len(records)} records to {output_path}")
        return

    print("Invalid export type.")


def export_all_list_types_json(settings):
    completed_path = input_path(
        f"Path to Completed JSON (default: {COMPLETED_PATH}): ",
        COMPLETED_PATH,
    )
    still_working_path = input_path(
        f"Path to StillWorking JSON (default: {STILL_WORKING_PATH}): ",
        STILL_WORKING_PATH,
    )

    output_dir = input_path("Output directory (default: exports): ", Path("exports"))
    output_dir.mkdir(parents=True, exist_ok=True)

    completed, still_working, combined = load_combined_results(completed_path, still_working_path)

    no_results = []
    with_results = []
    missing_staff_page = []

    for school_name, payload in combined.items():
        item = result_payload_to_school_item(school_name, payload)

        if item["ContactCount"] == 0:
            no_results.append(item)
        else:
            with_results.append(item)

        if not item["PagesWithContacts"]:
            missing_staff_page.append(item)

    empty_alt_urls = []
    for school, rule in settings["school_rules"].items():
        urls = rule.get("alt_urls", []) if isinstance(rule, dict) else []
        if not urls:
            empty_alt_urls.append(setting_rule_to_school_item(school, rule))

    all_names = build_school_catalog(settings, completed, still_working)

    outputs = {
        "schools_with_no_results.json": no_results,
        "schools_with_results.json": with_results,
        "schools_with_no_staff_page.json": missing_staff_page,
        "schools_with_empty_alt_urls.json": empty_alt_urls,
        "all_school_names.json": all_names,
    }

    for filename, payload in outputs.items():
        save_json(output_dir / filename, payload)

    print(f"Exported {len(outputs)} JSON files to {output_dir}")


def likely_person_name(name):
    reasons = []
    clean = str(name or "").strip()
    if not clean:
        return False, ["name is empty"]

    alpha_count = sum(1 for ch in clean if ch.isalpha())
    if alpha_count < 3:
        reasons.append("name has too few letters")
    if any(ch.isdigit() for ch in clean):
        reasons.append("name contains digits")

    lower = clean.lower()
    blocked_words = {
        "school",
        "district",
        "building",
        "department",
        "campus",
        "office",
        "academy",
        "elementary",
        "middle",
        "high",
        "board",
    }
    if any(word in lower for word in blocked_words):
        reasons.append("name looks like organization text")

    parts = [p for p in clean.replace(".", " ").split() if p]
    if len(parts) > 4:
        reasons.append("name has too many tokens")

    return len(reasons) == 0, reasons


def contact_unlikely_reasons(contact):
    if not isinstance(contact, dict):
        return ["contact is not an object"]

    reasons = []
    name = contact.get("name") or contact.get("Name")
    ok_name, name_reasons = likely_person_name(str(name or ""))
    if not ok_name:
        reasons.extend(name_reasons)

    title = str(contact.get("title") or contact.get("Title") or "").strip()
    if not title:
        reasons.append("missing title")

    return reasons


def school_unlikely_reasons(payload):
    if not isinstance(payload, dict):
        return ["record is not an object"]

    if payload.get("error"):
        return []

    reasons = []
    contacts = payload.get("contacts", [])
    school_urls = payload.get("school_urls", {})

    if not isinstance(contacts, list):
        reasons.append("contacts is not a list")

    if contacts and not isinstance(school_urls, dict):
        reasons.append("school_urls is missing")

    if contacts and isinstance(school_urls, dict):
        pages = school_urls.get("pages_with_contacts", [])
        if not isinstance(pages, list) or not pages:
            reasons.append("contacts found but pages_with_contacts is empty")

    return reasons


def triage_decision(prompt):
    while True:
        choice = input(prompt).strip().lower()
        if choice in {"k", "e", "q"}:
            return choice
        print("Choose k (keep), e (send to errors), or q (quit review).")


def review_unlikely_results():
    src = input_path(
        f"Path to results JSON (default: {COMPLETED_PATH}): ",
        COMPLETED_PATH,
    )
    if not src.exists():
        print("File not found.")
        return

    errors_path = input_path("Errors JSON path (default: errors.json): ", Path("errors.json"))

    data = load_result_map(src)

    if errors_path.exists():
        existing_errors = load_json(errors_path)
        if not isinstance(existing_errors, list):
            print("errors.json exists but is not a JSON array.")
            return
    else:
        existing_errors = []

    new_errors = []
    schools_to_remove = set()
    contacts_to_remove = {}
    reviewed = 0
    sent_to_errors = 0

    school_names = list(data.keys())

    for school_name in school_names:
        payload = data.get(school_name)
        if not isinstance(payload, dict):
            continue

        school_reasons = school_unlikely_reasons(payload)
        if school_reasons:
            reviewed += 1
            print("\n--- Unlikely School Result ---")
            print(f"School: {school_name}")
            print(f"Reasons: {', '.join(school_reasons)}")
            decision = triage_decision("Action? [k]eep / [e]rror / [q]uit: ")
            if decision == "q":
                break
            if decision == "e":
                new_errors.append(
                    {
                        "FlagType": "school_result",
                        "SchoolName": school_name,
                        "Reasons": school_reasons,
                        "Record": payload,
                    }
                )
                schools_to_remove.add(school_name)
                sent_to_errors += 1
                continue

        contacts = payload.get("contacts", [])
        if not isinstance(contacts, list):
            continue

        for contact_idx, contact in enumerate(contacts):
            contact_reasons = contact_unlikely_reasons(contact)
            if not contact_reasons:
                continue

            reviewed += 1
            display_name = contact.get("name") or contact.get("Name") if isinstance(contact, dict) else contact

            print("\n--- Unlikely Contact ---")
            print(f"School: {school_name}")
            print(f"Name: {display_name}")
            print(f"Reasons: {', '.join(contact_reasons)}")
            decision = triage_decision("Action? [k]eep / [e]rror / [q]uit: ")
            if decision == "q":
                break
            if decision == "e":
                school_urls = payload.get("school_urls", {})
                if not isinstance(school_urls, dict):
                    school_urls = {}

                new_errors.append(
                    {
                        "FlagType": "contact",
                        "SchoolName": school_name,
                        "BaseUrl": school_urls.get("base_url"),
                        "AltUrl": school_urls.get("alt_url"),
                        "PagesWithContacts": school_urls.get("pages_with_contacts", []),
                        "Reasons": contact_reasons,
                        "Contact": contact,
                    }
                )
                contacts_to_remove.setdefault(school_name, set()).add(contact_idx)
                sent_to_errors += 1
        else:
            continue
        break

    for school_name, indexes in contacts_to_remove.items():
        if school_name in schools_to_remove:
            continue
        contacts = data.get(school_name, {}).get("contacts", [])
        for contact_idx in sorted(indexes, reverse=True):
            if 0 <= contact_idx < len(contacts):
                contacts.pop(contact_idx)

    for school_name in schools_to_remove:
        data.pop(school_name, None)

    print("\nReview complete.")
    print(f"Reviewed flagged items: {reviewed}")
    print(f"Marked for errors: {sent_to_errors}")

    if sent_to_errors == 0:
        print("No changes to save.")
        return

    save_results = input("Save updated results JSON? (y/n): ").strip().lower() == "y"
    save_errors = input("Save/append errors JSON? (y/n): ").strip().lower() == "y"

    if save_results:
        save_json(src, data)
        print(f"Saved updated records to {src}")
    if save_errors:
        save_json(errors_path, existing_errors + new_errors)
        print(f"Saved {len(new_errors)} error item(s) to {errors_path}")
    if not save_results and not save_errors:
        print("No files were written.")


def convert_csv_to_json():
    src = input_path("CSV input path: ")
    if not src.exists():
        print("File not found.")
        return

    default_out = src.with_suffix(".json")
    output_path = input_path(f"Output JSON path (default: {default_out}): ", default_out)

    with src.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        rows = [dict(row) for row in reader]

    save_json(output_path, rows)
    print(f"Converted {len(rows)} row(s) to {output_path}")


def item_key(item):
    return json.dumps(item, sort_keys=True, ensure_ascii=False)


def list_to_index(data, key_field=None):
    index = {}
    order = []

    for item in data:
        if key_field:
            if not isinstance(item, dict) or key_field not in item:
                continue
            key = str(item.get(key_field, "")).strip().lower()
            if not key:
                continue
        else:
            key = item_key(item)

        if key not in index:
            order.append(key)
        index[key] = item

    return index, order


def json_set_operations():
    print("\nJSON Set Operations")
    print("1) Union (A ∪ B)")
    print("2) Intersect (A ∩ B)")
    print("3) Difference (A - B)")
    op = input("Choose operation: ").strip()
    if op not in {"1", "2", "3"}:
        print("Invalid operation.")
        return

    a_path = input_path("Path to file A: ")
    b_path = input_path("Path to file B: ")
    if not a_path.exists() or not b_path.exists():
        print("One or both files were not found.")
        return

    a_data = load_json(a_path)
    b_data = load_json(b_path)

    if type(a_data) is not type(b_data):
        print("Top-level JSON types do not match. Both files must be list or both must be object.")
        return

    output_path = input_path("Output JSON path (default: set_result.json): ", Path("set_result.json"))

    if isinstance(a_data, list):
        use_key = input("Use a key field for list-of-objects matching? (leave blank for full-object match): ").strip()
        key_field = use_key if use_key else None

        a_index, a_order = list_to_index(a_data, key_field)
        b_index, b_order = list_to_index(b_data, key_field)
        a_keys = set(a_index.keys())
        b_keys = set(b_index.keys())

        if op == "1":
            out_keys = list(a_order) + [key for key in b_order if key not in a_keys]
            result = [a_index[key] if key in a_index else b_index[key] for key in out_keys]
        elif op == "2":
            out_keys = [key for key in a_order if key in b_keys]
            result = [a_index[key] for key in out_keys]
        else:
            out_keys = [key for key in a_order if key not in b_keys]
            result = [a_index[key] for key in out_keys]

        save_json(output_path, result)
        print(f"Saved {len(result)} item(s) to {output_path}")
        return

    if isinstance(a_data, dict):
        a_keys = set(a_data.keys())
        b_keys = set(b_data.keys())

        if op == "1":
            result = dict(a_data)
            result.update(b_data)
        elif op == "2":
            shared = sorted(a_keys.intersection(b_keys))
            result = {key: a_data[key] for key in shared}
        else:
            only_a = sorted(a_keys.difference(b_keys))
            result = {key: a_data[key] for key in only_a}

        save_json(output_path, result)
        print(f"Saved {len(result)} key(s) to {output_path}")
        return

    print("Unsupported JSON type.")


def search_schools(settings):
    index_map = build_school_name_index_map(SCHOOLS_PATH)

    term = input("Search term: ").strip().lower()
    if not term:
        print("No search term provided.")
        return

    matches = []
    for school, rule in settings["school_rules"].items():
        if term in school.lower():
            matches.append((school, rule))

    if not matches:
        print("No matching schools found.")
        return

    print(f"Found {len(matches)} school(s):")
    for school, rule in matches:
        urls = rule.get("alt_urls", []) if isinstance(rule, dict) else []
        indexes = index_map.get(school, [])
        if indexes:
            idx_text = ", ".join(str(i) for i in indexes)
        else:
            idx_text = "not found"
        print(f"- {school} [index: {idx_text}] ({len(urls)} alt url(s))")


def create_school(settings):
    name = input("New school name: ").strip()
    if not name:
        print("School name cannot be empty.")
        return
    if name in settings["school_rules"]:
        print("School already exists.")
        return

    urls = input_urls("Alt URLs (comma-separated): ")
    settings["school_rules"][name] = {"alt_urls": urls}
    print("School created.")


def read_school(settings):
    name = input("School name: ").strip()
    rule = settings["school_rules"].get(name)
    if not rule:
        print("School not found.")
        return

    print(json.dumps({name: rule}, indent=2, ensure_ascii=False))


def update_school(settings):
    name = input("School name to edit: ").strip()
    if name not in settings["school_rules"]:
        print("School not found.")
        return

    rule = settings["school_rules"][name]
    rule.setdefault("alt_urls", [])

    print("1) Rename school")
    print("2) Replace all alt_urls")
    print("3) Add alt_urls")
    print("4) Remove alt_urls")
    choice = input("Choose edit action: ").strip()

    if choice == "1":
        new_name = input("New school name: ").strip()
        if not new_name:
            print("Name cannot be empty.")
            return
        if new_name != name and new_name in settings["school_rules"]:
            print("That school name already exists.")
            return
        settings["school_rules"][new_name] = settings["school_rules"].pop(name)
        print("School renamed.")

    elif choice == "2":
        new_urls = input_urls("New alt_urls (comma-separated): ")
        settings["school_rules"][name]["alt_urls"] = new_urls
        print("alt_urls replaced.")

    elif choice == "3":
        new_urls = input_urls("URLs to add (comma-separated): ")
        merged = settings["school_rules"][name].get("alt_urls", []) + new_urls
        settings["school_rules"][name]["alt_urls"] = normalize_urls(merged)
        print("URLs added.")

    elif choice == "4":
        remove_urls = set(input_urls("URLs to remove (comma-separated): "))
        kept = [url for url in settings["school_rules"][name].get("alt_urls", []) if url not in remove_urls]
        settings["school_rules"][name]["alt_urls"] = kept
        print("URLs removed.")

    else:
        print("Invalid option.")


def delete_school(settings):
    name = input("School name to delete: ").strip()
    if name not in settings["school_rules"]:
        print("School not found.")
        return

    confirm = input(f"Delete '{name}'? (y/n): ").strip().lower()
    if confirm == "y":
        settings["school_rules"].pop(name, None)
        print("School deleted.")
    else:
        print("Cancelled.")


def add_all_from_json(settings):
    src = input_path("Path to JSON to ADD from: ")
    if not src.exists():
        print("File not found.")
        return

    incoming = load_json(src)
    incoming_rules = extract_school_rules_from_any_json(incoming)
    if not incoming_rules:
        print("No school data found in source JSON.")
        return

    added_or_updated = 0

    for school, rule in incoming_rules.items():
        if not isinstance(rule, dict):
            continue

        urls = normalize_urls(rule.get("alt_urls", []))

        if school not in settings["school_rules"]:
            settings["school_rules"][school] = {"alt_urls": urls}
            added_or_updated += 1
            continue

        merged = settings["school_rules"][school].get("alt_urls", []) + urls
        settings["school_rules"][school]["alt_urls"] = normalize_urls(merged)
        added_or_updated += 1

    print(f"Merged {added_or_updated} school record(s) from {src}.")


def delete_all_from_json(settings):
    src = input_path("Path to JSON to DELETE by: ")
    if not src.exists():
        print("File not found.")
        return

    incoming = load_json(src)
    names_to_delete = extract_school_names_from_any_json(incoming)
    if not names_to_delete:
        print("No school names found in source JSON.")
        return

    existing = set(settings["school_rules"].keys())
    to_delete = sorted(existing.intersection(names_to_delete))

    if not to_delete:
        print("No matching schools found to delete.")
        return

    print(f"Will delete {len(to_delete)} school(s).")
    confirm = input("Continue? (y/n): ").strip().lower()
    if confirm != "y":
        print("Cancelled.")
        return

    for school in to_delete:
        settings["school_rules"].pop(school, None)

    print(f"Deleted {len(to_delete)} school(s).")


def print_menu():
    print("\n=== JSON Editor ===")
    print("1) Search schools")
    print("2) Create school")
    print("3) Read school")
    print("4) Update school")
    print("5) Delete school")
    print("6) Add all schools from JSON into settings.json")
    print("7) Delete all schools from JSON in settings.json")
    print("8) Count schools with no contacts")
    print("9) Count schools with contacts")
    print("10) Export list type to JSON")
    print("11) Export all list types to JSON files")
    print("12) Review unlikely names/results")
    print("13) Convert CSV to JSON")
    print("14) JSON set ops (union/intersect/difference)")
    print("15) Save")
    print("16) Exit without save")


def main():
    if not SETTINGS_PATH.exists():
        print(f"settings.json not found at: {SETTINGS_PATH.resolve()}")
        return

    settings = ensure_settings_shape(load_json(SETTINGS_PATH))
    dirty = False

    while True:
        print_menu()
        choice = input("Choose an option: ").strip()

        if choice == "1":
            search_schools(settings)
        elif choice == "2":
            create_school(settings)
            dirty = True
        elif choice == "3":
            read_school(settings)
        elif choice == "4":
            update_school(settings)
            dirty = True
        elif choice == "5":
            delete_school(settings)
            dirty = True
        elif choice == "6":
            add_all_from_json(settings)
            dirty = True
        elif choice == "7":
            delete_all_from_json(settings)
            dirty = True
        elif choice == "8":
            count_no_results()
        elif choice == "9":
            count_with_results()
        elif choice == "10":
            export_list_types_json(settings)
        elif choice == "11":
            export_all_list_types_json(settings)
        elif choice == "12":
            review_unlikely_results()
        elif choice == "13":
            convert_csv_to_json()
        elif choice == "14":
            json_set_operations()
        elif choice == "15":
            save_json(SETTINGS_PATH, settings)
            dirty = False
            print("Saved settings.json")
        elif choice == "16":
            print("Goodbye.")
            break
        else:
            print("Invalid option.")


if __name__ == "__main__":
    main()
