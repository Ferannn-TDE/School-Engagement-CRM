import csv
from html import escape
from io import BytesIO, StringIO
import json
from pathlib import Path
import re
import time
import xml.etree.ElementTree as ElementTree
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import zipfile

import requests
from bs4 import BeautifulSoup

from helpers import clean, header_key, normalize


class SourceReader:
    def __init__(self, settings, session=None, cache=None, header_aliases=(), name_aliases=()):
        self.settings = settings
        self.session = session or requests.Session()
        self.cache = cache if cache is not None else {}
        self.header_aliases = header_aliases
        self.name_aliases = name_aliases
        self.final_url = settings.get("url", "")

    def rows(self, settings=None, depth=0):
        settings = settings or self.settings
        url = settings.get("url", "")
        if not url:
            raise RuntimeError("The source URL is empty.")

        url_values = settings.get("url_values", ())
        if url_values and depth == 0:
            combined = []
            child = dict(settings)
            child.pop("url_values", None)
            for value in url_values:
                child["url"] = url.format(value=value)
                combined.extend(self.rows(child, depth=1))
            self.final_url = url
            return combined

        kind = normalize(settings.get("kind", "auto"))
        if kind == "arcgis" or re.search(r"/(mapserver|featureserver)/\d+/?$", url, re.I):
            return self.arcgis_rows(url, settings)
        if kind == "powerapps":
            return self.powerapps_rows(url, settings)
        if kind == "json api":
            return self.json_api_rows(url, settings)
        if kind == "form":
            return self.form_rows(url, settings)
        if kind == "html select":
            content, _content_type, final_url = self.download(url)
            self.final_url = final_url
            return self.selector_rows(content, final_url, settings)

        content, content_type, final_url = self.download(url)
        self.final_url = final_url
        file_format = self.detect_format(content, content_type, final_url, settings)

        if file_format == "html" and depth == 0:
            page_rows = self.html_rows(content, settings)
            if page_rows and (not self.name_aliases or self.has_named_column(page_rows)):
                return page_rows
            for link in self.file_links(content, final_url, settings):
                try:
                    child = dict(settings)
                    child["url"] = link
                    child["kind"] = "auto"
                    rows = self.rows(child, depth=1)
                    if self.name_aliases and not self.has_named_column(rows):
                        continue
                    return rows
                except Exception:
                    continue

        return self.try_parsers(content, file_format, settings)

    def download(self, url):
        if url in self.cache:
            return self.cache[url]

        error = None
        attempts = max(1, int(self.settings.get("download_attempts", 3)))
        delay = max(0, float(self.settings.get("retry_delay", 1)))
        for attempt in range(attempts):
            try:
                response = self.session.get(
                    url,
                    headers={"Accept": "*/*"},
                    timeout=(20, 120),
                    allow_redirects=True,
                )
                response.raise_for_status()
                result = (
                    response.content,
                    normalize(response.headers.get("Content-Type", "")),
                    response.url,
                )
                self.cache[url] = result
                return result
            except requests.RequestException as caught:
                error = caught
                status = getattr(getattr(caught, "response", None), "status_code", None)
                retryable = status is None or status in {408, 425, 429, 500, 502, 503, 504}
                if not retryable or attempt + 1 == attempts:
                    break
                if delay:
                    time.sleep(delay * (attempt + 1))
        raise RuntimeError(f"Download failed: {error}")

    @staticmethod
    def detect_format(content, content_type, url, settings):
        chosen = normalize(settings.get("format", "auto"))
        if chosen not in {"", "auto"}:
            return chosen

        suffix = Path(urlsplit(url).path).suffix.casefold().lstrip(".")
        start = content.lstrip()[:40].lower()
        if content.startswith(b"\xd0\xcf\x11\xe0"):
            return "xls"
        if content.startswith(b"PK\x03\x04"):
            if suffix in {"xlsx", "xlsm"} or "spreadsheet" in content_type:
                return "xlsx"
            return "zip"
        if suffix in {"csv", "tsv", "json", "xml", "xlsx", "xls", "zip"}:
            return suffix
        if start.startswith((b"{", b"[")) or "json" in content_type:
            return "json"
        if start.startswith(b"<?xml") or "xml" in content_type:
            return "xml"
        if (
            start.startswith((b"<!doctype html", b"<html", b"<table", b"<thead", b"<tbody", b"<tr"))
            or b"<table" in content.lstrip()[:1000].lower()
            or "html" in content_type
        ):
            return "html"
        if "csv" in content_type or content_type.startswith("text/"):
            return "csv"
        return "unknown"

    def try_parsers(self, content, first_format, settings):
        parsers = {
            "xlsx": self.excel_rows,
            "xls": self.excel_rows,
            "csv": self.csv_rows,
            "tsv": self.csv_rows,
            "json": self.json_rows,
            "xml": self.xml_rows,
            "html": self.html_rows,
            "zip": self.zip_rows,
        }
        order = [first_format, "xlsx", "xls", "json", "csv", "xml", "html", "zip"]
        errors = []

        for file_format in dict.fromkeys(order):
            parser = parsers.get(file_format)
            if parser is None:
                continue
            try:
                rows = parser(content, settings, file_format)
                if rows and any(len(row) >= 2 for row in rows):
                    return rows
                errors.append(f"{file_format}: no usable rows found")
            except Exception as error:
                errors.append(f"{file_format}: {error}")

        first_error = next(
            (error for error in errors if error.startswith(first_format + ":")),
            "",
        )
        detail = "; ".join(
            dict.fromkeys(error for error in [first_error] + errors[-2:] if error)
        )
        raise RuntimeError(f"No reader understood the source format. {detail}")

    def csv_rows(self, content, settings, file_format="csv"):
        text = ""
        for encoding in (settings.get("encoding", ""), "utf-8-sig", "utf-16", "latin-1"):
            if not encoding:
                continue
            try:
                text = content.decode(encoding)
                break
            except UnicodeError:
                continue
        if not text:
            return []

        delimiter = "\t" if file_format == "tsv" else None
        if delimiter is None:
            try:
                delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",\t;|").delimiter
            except csv.Error:
                delimiter = ","
        matrix = list(csv.reader(StringIO(text, newline=""), delimiter=delimiter))
        return self.matrix_rows(matrix, settings)

    def has_named_column(self, rows):
        aliases = {header_key(value) for value in self.name_aliases}
        for row in rows[:100]:
            for heading in row:
                name = header_key(heading)
                if name in aliases:
                    return True
                if any(len(alias) >= 5 and alias in name for alias in aliases):
                    return True
        return False

    def excel_rows(self, content, settings, file_format="xlsx"):
        sheets = []
        if file_format == "xlsx":
            import openpyxl

            try:
                workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
            except TypeError:
                workbook = openpyxl.load_workbook(
                    BytesIO(self.repair_excel_styles(content)),
                    read_only=True,
                    data_only=True,
                )
            for sheet in workbook.worksheets:
                sheets.append((sheet.title, list(sheet.values)))
            workbook.close()
        else:
            import xlrd

            workbook = xlrd.open_workbook(file_contents=content)
            for sheet in workbook.sheets():
                sheets.append((
                    sheet.name,
                    [sheet.row_values(number) for number in range(sheet.nrows)],
                ))

        wanted = [normalize(value) for value in settings.get("sheets", ())]
        rows = []
        for sheet_name, matrix in sheets:
            if wanted and not any(term in normalize(sheet_name) for term in wanted):
                continue
            for row in self.matrix_rows(matrix, settings):
                row["_sheet"] = sheet_name
                rows.append(row)
        return rows

    @staticmethod
    def repair_excel_styles(content):
        output = BytesIO()
        namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        with zipfile.ZipFile(BytesIO(content)) as source:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
                for item in source.infolist():
                    data = source.read(item.filename)
                    if item.filename == "xl/styles.xml":
                        root = ElementTree.fromstring(data)
                        for fill in root.findall(f"{namespace}fills/{namespace}fill"):
                            if not list(fill):
                                ElementTree.SubElement(
                                    fill,
                                    f"{namespace}patternFill",
                                    {"patternType": "none"},
                                )
                        data = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
                    target.writestr(item, data)
        return output.getvalue()

    def matrix_rows(self, matrix, settings):
        matrix = [list(row) for row in matrix]
        if not matrix or not any(any(clean(value) for value in row) for row in matrix):
            return []

        header_rows = settings.get("header_rows", ())
        configured = settings.get("header_row")
        header_number = (
            max(int(number) for number in header_rows)
            if header_rows
            else int(configured) if configured is not None
            else self.find_header(matrix)
        )
        if header_number >= len(matrix):
            return []

        header_matrix = [matrix[int(number)] for number in header_rows] if header_rows else [matrix[header_number]]
        column_count = max(len(row) for row in header_matrix)
        headings = []
        used = {}
        for number in range(column_count):
            values = [clean(row[number]) for row in header_matrix if number < len(row) and clean(row[number])]
            heading = (values[-1] if values else "") or f"Column {number + 1}"
            count = used.get(heading, 0) + 1
            used[heading] = count
            headings.append(heading if count == 1 else f"{heading} {count}")

        rows = []
        for values in matrix[header_number + 1:]:
            row = {
                heading: self.cell(value)
                for heading, value in zip(headings, values)
                if clean(value)
            }
            if row:
                rows.append(row)
        return rows

    def find_header(self, matrix):
        aliases = {header_key(alias) for alias in self.header_aliases}
        best_row = 0
        best_score = -1
        for number, row in enumerate(matrix[:30]):
            headings = [header_key(value) for value in row if clean(value)]
            matches = sum(1 for value in headings if value in aliases)
            school_name = any(value in {"schoolname", "facilityname", "institutionname"} for value in headings)
            score = matches * 10 + (20 if school_name else 0) + min(len(headings), 10)
            if score > best_score:
                best_row = number
                best_score = score
        return best_row

    @staticmethod
    def cell(value):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return value

    def json_rows(self, content, settings, _file_format="json"):
        value = json.loads(content)
        path = settings.get("records_path", "")
        if path:
            for part in path.split("."):
                value = value[part]
        else:
            value = self.largest_record_list(value)
        if not isinstance(value, list):
            return []
        return [
            item.get("attributes", item.get("properties", item))
            for item in value
            if isinstance(item, dict)
        ]

    def json_api_rows(self, url, settings):
        """Read a cursor-paged JSON endpoint without knowing its row shape."""
        parsed = urlsplit(url)
        parameters = dict(parse_qsl(parsed.query, keep_blank_values=True))
        parameters.update({str(key): str(value) for key, value in settings.get("params", {}).items()})
        base_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
        cursor_path = clean(settings.get("cursor_path", ""))
        cursor_parameter = clean(settings.get("cursor_parameter", "cursor"))
        total_path = clean(settings.get("total_path", ""))
        size_parameter = clean(settings.get("size_parameter", "size"))
        maximum = max(1, int(settings.get("maximum_pages", 50)))
        rows = []
        seen_cursors = set()

        for _page in range(maximum):
            page_url = self.parameterized_url(base_url, parameters)
            try:
                content, _content_type, final_url = self.download(page_url)
            except RuntimeError:
                # A few directory APIs return HTTP 500 instead of a smaller
                # final page. On the first page, find a size the endpoint will
                # accept; on later pages, keep the rows already collected.
                content = None
                if not rows and size_parameter in parameters:
                    try:
                        requested = int(parameters[size_parameter])
                    except (TypeError, ValueError):
                        requested = 0
                    for size in (requested // 2, 100, 50, 25):
                        if size <= 0 or size >= requested:
                            continue
                        parameters[size_parameter] = str(size)
                        page_url = self.parameterized_url(base_url, parameters)
                        try:
                            content, _content_type, final_url = self.download(page_url)
                            break
                        except RuntimeError:
                            continue
                if content is not None:
                    pass
                elif rows and settings.get("partial_pages", False):
                    break
                else:
                    raise
            self.final_url = final_url
            data = json.loads(content)

            value = data
            path = clean(settings.get("records_path", ""))
            if path:
                for part in path.split("."):
                    value = value[part]
            else:
                value = self.largest_record_list(value)
            batch = [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
            rows.extend(batch)

            if total_path and size_parameter in parameters:
                total = data
                try:
                    for part in total_path.split("."):
                        total = total[part]
                    remaining = int(total) - len(rows)
                    requested = int(parameters[size_parameter])
                    if remaining <= requested:
                        # Some cursor APIs reject a final request that reaches
                        # the exact result-window boundary. Leaving one row is
                        # preferable to discarding every earlier page.
                        if remaining <= 1:
                            break
                        parameters[size_parameter] = str(remaining - 1)
                except (KeyError, TypeError, ValueError):
                    pass

            cursor = data
            if not cursor_path:
                break
            try:
                for part in cursor_path.split("."):
                    cursor = cursor[part]
            except (KeyError, TypeError):
                cursor = ""
            cursor = clean(cursor)
            if not batch or not cursor or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
            parameters[cursor_parameter] = cursor

        return rows

    @staticmethod
    def parameterized_url(base_url, parameters):
        return base_url + ("?" + urlencode(parameters) if parameters else "")

    @staticmethod
    def largest_record_list(value):
        choices = []

        def visit(item):
            if isinstance(item, list):
                if item and all(isinstance(row, dict) for row in item[:10]):
                    choices.append(item)
                for child in item[:20]:
                    visit(child)
            elif isinstance(item, dict):
                for child in item.values():
                    visit(child)

        visit(value)
        return max(choices, key=len) if choices else value

    @staticmethod
    def xml_rows(content, _settings, _file_format="xml"):
        root = ElementTree.fromstring(content)
        groups = {}
        for parent in root.iter():
            children = list(parent)
            if children and all(not list(child) for child in children):
                tag = parent.tag.split("}")[-1]
                groups.setdefault(tag, []).append(parent)
        records = max(groups.values(), key=len) if groups else []
        return [
            {child.tag.split("}")[-1]: clean(child.text) for child in record}
            for record in records
        ]

    def html_rows(self, content, settings, _file_format="html"):
        soup = BeautifulSoup(content, "html.parser")
        all_rows = []
        for table in soup.find_all("table"):
            matrix = self.html_matrix(table)
            rows = self.matrix_rows(matrix, settings)
            if len(rows) > len(all_rows):
                all_rows = rows
        return all_rows

    @staticmethod
    def html_matrix(table):
        """Build a rectangular table while honoring ordinary HTML cell spans."""
        matrix = []
        pending = {}
        for html_row in table.find_all("tr"):
            if html_row.find_parent("table") is not table:
                continue

            values = []
            column = 0

            def fill_pending():
                nonlocal column
                while column in pending:
                    remaining, value = pending[column]
                    values.append(value)
                    if remaining <= 1:
                        del pending[column]
                    else:
                        pending[column] = (remaining - 1, value)
                    column += 1

            for cell in html_row.find_all(["th", "td"], recursive=False):
                fill_pending()
                value = cell.get_text(" ", strip=True)
                try:
                    colspan = max(1, int(cell.get("colspan", 1)))
                    rowspan = max(1, int(cell.get("rowspan", 1)))
                except (TypeError, ValueError):
                    colspan = rowspan = 1
                for offset in range(colspan):
                    values.append(value)
                    if rowspan > 1:
                        pending[column + offset] = (rowspan - 1, value)
                column += colspan
            fill_pending()
            if values:
                matrix.append(values)
        return matrix

    @staticmethod
    def selector_rows(content, page_url, settings):
        """Turn repeated HTML elements into records using configured CSS selectors."""
        soup = BeautifulSoup(content, "html.parser")
        row_selector = clean(settings.get("row_selector", ""))
        fields = settings.get("fields", {})
        if not row_selector or not fields:
            raise RuntimeError("An HTML selector source needs row_selector and fields.")

        rows = []
        for element in soup.select(row_selector):
            row = {}
            for heading, rule in fields.items():
                if isinstance(rule, str):
                    rule = {"selector": rule}
                rule = rule or {}
                if "constant" in rule:
                    value = clean(rule["constant"])
                else:
                    selector = clean(rule.get("selector", ""))
                    selected = element.select_one(selector) if selector else element
                    if selected is None:
                        continue
                    attribute = clean(rule.get("attribute", ""))
                    value = clean(selected.get(attribute, "")) if attribute else selected.get_text(" ", strip=True)

                pattern = clean(rule.get("regex", ""))
                if pattern:
                    match = re.search(pattern, value, re.I)
                    if not match:
                        continue
                    group = int(rule.get("group", 1 if match.lastindex else 0))
                    value = clean(match.group(group))
                if rule.get("resolve_url"):
                    value = urljoin(page_url, value)
                if value:
                    row[heading] = value
            if row:
                rows.append(row)
        return rows

    def zip_rows(self, content, settings, _file_format="zip"):
        rows = []
        with zipfile.ZipFile(BytesIO(content)) as archive:
            files = [
                item for item in archive.infolist()
                if not item.is_dir() and item.file_size <= 30_000_000
            ]
            preferred = normalize(settings.get("file_name", ""))
            if preferred:
                files.sort(key=lambda item: preferred not in normalize(item.filename))
            for item in files:
                suffix = Path(item.filename).suffix.casefold().lstrip(".")
                if suffix not in {"csv", "tsv", "json", "xml", "xlsx", "xls"}:
                    continue
                child_settings = dict(settings)
                child_settings["format"] = suffix
                try:
                    rows.extend(self.try_parsers(archive.read(item), suffix, child_settings))
                except Exception:
                    continue
        return rows

    def powerapps_rows(self, landing_url, settings):
        landing = self.session.get(landing_url, timeout=(20, 120), allow_redirects=True)
        landing.raise_for_status()
        base_url = landing.url or landing_url

        token_url = urljoin(base_url, settings.get("token_path", "/_services/auth/portalusertoken"))
        token_response = self.session.post(token_url, timeout=(20, 120))
        token_response.raise_for_status()
        token = clean(token_response.text)
        if not token:
            raise RuntimeError("The Power Apps portal did not provide an access token.")

        fields = [clean(field) for field in settings.get("fields", ()) if clean(field)]
        if not fields:
            raise RuntimeError("The Power Apps source has no configured fields.")

        entity = clean(settings.get("entity", "account"))
        fetch = ["<fetch distinct='true'>", f"<entity name='{escape(entity, quote=True)}'>"]
        fetch.extend(f"<attribute name='{escape(field, quote=True)}'/>" for field in fields)
        filters = settings.get("filters", ())
        if filters:
            fetch.append("<filter>")
            for condition in filters:
                field = escape(clean(condition.get("field")), quote=True)
                operator = escape(clean(condition.get("operator", "eq")), quote=True)
                value = escape(clean(condition.get("value")), quote=True)
                if field and operator:
                    fetch.append(
                        f"<condition attribute='{field}' operator='{operator}' value='{value}'/>"
                    )
            fetch.append("</filter>")
        fetch.extend(("</entity>", "</fetch>"))

        api_url = urljoin(base_url, settings.get("api_path", "/_api/accounts"))
        headers = {
            "Accept": "application/json",
            "Prefer": "odata.include-annotations=*",
            "__RequestVerificationToken": token,
        }
        rows = []
        next_url = api_url
        parameters = {"fetchXml": "".join(fetch)}
        for _page in range(20):
            response = self.session.get(
                next_url,
                params=parameters,
                headers=headers,
                timeout=(20, 120),
            )
            response.raise_for_status()
            data = response.json()
            rows.extend(item for item in data.get("value", ()) if isinstance(item, dict))
            next_url = data.get("@odata.nextLink", "")
            if not next_url:
                break
            parameters = None

        self.final_url = api_url
        return rows

    def form_rows(self, landing_url, settings):
        response = self.session.get(landing_url, timeout=(20, 120), allow_redirects=True)
        response.raise_for_status()

        for step in settings.get("posts", ()):
            option_field = clean(step.get("for_each_option", ""))
            if option_field:
                soup = BeautifulSoup(response.content, "html.parser")
                select = soup.find("select", attrs={"name": option_field})
                if select is None:
                    raise RuntimeError(f"Form option field was not found: {option_field}")
                rows = []
                errors = []
                for option in select.find_all("option"):
                    value = clean(option.get("value", ""))
                    if value:
                        try:
                            exported = self.submit_form(response, step, {option_field: value})
                            rows.extend(self.form_response_rows(exported, settings))
                        except Exception as error:
                            errors.append(f"{value}: {error}")
                if not rows and errors:
                    raise RuntimeError("Every form option failed: " + "; ".join(errors[:3]))
                return rows

            response = self.submit_form(response, step)

        selector = clean(settings.get("postback_selector", ""))
        if selector:
            rows = self.form_response_rows(response, settings)
            soup = BeautifulSoup(response.content, "html.parser")
            targets = []
            for link in soup.select(selector):
                if "current" in link.get("class", ()):
                    continue
                action = " ".join((link.get("href", ""), link.get("onclick", "")))
                match = re.search(r"__doPostBack\('([^']+)'", action)
                if match and match.group(1) not in targets:
                    targets.append(match.group(1))

            keep = settings.get("postback_values", {})
            maximum = int(settings.get("maximum_pages", 25))
            for target in targets[:maximum - 1]:
                page = self.submit_form(response, {
                    "event_target": target,
                    "values": keep,
                })
                rows.extend(self.form_response_rows(page, settings))
            return rows

        return self.form_response_rows(response, settings)

    def submit_form(self, response, step, extra_values=None):
        soup = BeautifulSoup(response.content, "html.parser")
        values = {}
        if step.get("hidden", True):
            values.update({
                field.get("name"): field.get("value", "")
                for field in soup.select("input[type=hidden][name]")
            })
        values.update({clean(key): clean(value) for key, value in step.get("values", {}).items()})
        values.update(extra_values or {})
        event_target = clean(step.get("event_target", ""))
        if event_target:
            values["__EVENTTARGET"] = event_target
            values["__EVENTARGUMENT"] = clean(step.get("event_argument", ""))

        post_url = clean(step.get("url", ""))
        if not post_url:
            form = soup.find("form", action=True)
            post_url = form.get("action", "") if form else response.url
        exported = self.session.post(
            urljoin(response.url, post_url),
            data=values,
            headers={"Referer": response.url},
            timeout=(20, 120),
            allow_redirects=True,
        )
        exported.raise_for_status()
        return exported

    def form_response_rows(self, response, settings):
        self.final_url = response.url
        file_format = self.detect_format(
            response.content,
            normalize(response.headers.get("Content-Type", "")),
            response.url,
            settings,
        )
        return self.try_parsers(response.content, file_format, settings)

    @staticmethod
    def file_links(content, page_url, settings):
        soup = BeautifulSoup(content, "html.parser")
        terms = [normalize(term) for term in settings.get(
            "link_terms",
            ("school", "directory", "building", "institution", "download", "export"),
        )]
        links = []
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            label = normalize(link.get_text(" ", strip=True) + " " + href)
            file_words = ("xls", "csv", "json", "xml", "zip", "download", "export")
            if not any(word in label for word in file_words):
                continue
            score = sum(3 for term in terms if term and term in label)
            score += 2 if "current" in label else 0
            score -= 5 if any(word in label for word in ("archive", "historic", "pdf")) else 0
            links.append((score, urljoin(page_url, href)))
        links.sort(key=lambda item: item[0], reverse=True)
        return list(dict.fromkeys(url for _score, url in links[:8]))

    def arcgis_rows(self, layer_url, settings):
        query_url = layer_url.rstrip("/") + "/query"
        rows = []
        offset = 0
        page_size = int(settings.get("page_size", 1000))

        while True:
            parameters = {
                "where": settings.get("where", "1=1"),
                "outFields": settings.get("fields", "*"),
                "returnGeometry": "false",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "json",
            }
            if settings.get("order_by"):
                parameters["orderByFields"] = settings["order_by"]

            response = self.session.get(
                query_url,
                params=parameters,
                timeout=(20, 120),
            )
            response.raise_for_status()
            data = response.json()
            if data.get("error"):
                raise RuntimeError(data["error"].get("message", "ArcGIS query failed."))

            batch = [
                feature.get("attributes", feature)
                for feature in data.get("features", [])
                if isinstance(feature, dict)
            ]
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += len(batch)

        self.final_url = layer_url
        return rows
