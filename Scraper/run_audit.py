"""Snapshot the database before a scraper run, and list what the run changed.

    python run_audit.py snapshot --label run_123_1
    python run_audit.py changes  --label run_123_1 --out output

`snapshot` copies schools, staff, contacts and events into
backup.scraper_run_<label>_<table> inside the database (a schema the app and the
API can't read, so contact details never leave the database). `changes` compares the
live tables with that copy and writes <out>/changes.csv (table, key, column, before,
after) and <out>/changes_summary.json, and adds the summary to the GitHub job page
when GITHUB_STEP_SUMMARY is set.

Why (2026-09-30/10-01): two runs of the old scraper rewrote ~170 staff values with no
record of what they had replaced; putting them back needed hand-made exports. With a
snapshot per run, any run can be checked and undone from the database itself.
"""

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

TABLES = {
    "schools": ("facility_key",),
    "staff": ("staff_id",),
    "contacts": ("school_id", "staff_id"),
    "events": ("event_id",),
}

# Stamped on every row a run touches; counted, but not listed value by value.
STAMPS = {"updated_at", "last_scraped_at", "source_checked_at", "scraper_score_at"}

LABEL = re.compile(r"^[a-z0-9_]{1,40}$")


def connect(url):
    import psycopg

    return psycopg.connect(url, connect_timeout=15)


def snapshot_table(label, table):
    if not LABEL.fullmatch(label):
        raise ValueError(f"Label must be lowercase letters, digits and _ (got {label!r}).")
    return f"scraper_run_{label}_{table}"


def snapshot(url, label, source="public", backup="backup", connection_factory=connect):
    """Copies the four tables into the backup schema. Refuses to overwrite a label."""
    counts = {}
    with connection_factory(url) as conn:
        with conn.cursor() as cur:
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{backup}"')
            for table in TABLES:
                name = snapshot_table(label, table)
                cur.execute(
                    "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
                    (backup, name),
                )
                if cur.fetchone():
                    raise RuntimeError(f"Snapshot {backup}.{name} already exists; use a new label.")
                cur.execute(f'CREATE TABLE "{backup}"."{name}" AS SELECT * FROM "{source}"."{table}"')
                cur.execute(f'ALTER TABLE "{backup}"."{name}" ENABLE ROW LEVEL SECURITY')
                for role in ("anon", "authenticated"):
                    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
                    if cur.fetchone():
                        cur.execute(f'REVOKE ALL ON "{backup}"."{name}" FROM {role}')
                cur.execute(f'SELECT count(*) FROM "{backup}"."{name}"')
                counts[table] = cur.fetchone()[0]
    return counts


def rows_by_key(cur, schema, table, keys):
    cur.execute(f'SELECT to_jsonb(t) FROM "{schema}"."{table}" t')
    return {tuple(row[0].get(k) for k in keys): row[0] for row in cur.fetchall()}


def changes(url, label, source="public", backup="backup", connection_factory=connect):
    """Every value that differs between the snapshot and now, plus added/missing rows."""
    lines = []
    summary = {}
    with connection_factory(url) as conn:
        with conn.cursor() as cur:
            for table, keys in TABLES.items():
                before = rows_by_key(cur, backup, snapshot_table(label, table), keys)
                after = rows_by_key(cur, source, table, keys)
                stats = {"added": 0, "gone": 0, "rows_changed": 0, "values_changed": 0, "stamped_only": 0}
                for key in sorted(set(before) | set(after), key=str):
                    shown = "|".join(str(k) for k in key)
                    if key not in before:
                        stats["added"] += 1
                        lines.append((table, shown, "(added)", "", json.dumps(after[key], default=str)))
                        continue
                    if key not in after:
                        stats["gone"] += 1
                        lines.append((table, shown, "(gone)", json.dumps(before[key], default=str), ""))
                        continue
                    columns = [c for c in after[key] if after[key].get(c) != before[key].get(c)]
                    real = [c for c in columns if c not in STAMPS]
                    if real:
                        stats["rows_changed"] += 1
                        stats["values_changed"] += len(real)
                        for column in real:
                            lines.append((table, shown, column,
                                          json.dumps(before[key].get(column), default=str),
                                          json.dumps(after[key].get(column), default=str)))
                    elif columns:
                        stats["stamped_only"] += 1
                summary[table] = stats
    return lines, summary


def write_changes(lines, summary, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "changes.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["table", "key", "column", "before", "after"])
        writer.writerows(lines)
    (out / "changes_summary.json").write_text(json.dumps(summary, indent=2))
    text = ["| table | rows changed | values changed | added | gone | stamped only |",
            "|---|---|---|---|---|---|"]
    for table, s in summary.items():
        text.append(f"| {table} | {s['rows_changed']} | {s['values_changed']} | {s['added']} | {s['gone']} | {s['stamped_only']} |")
    report = "\n".join(text)
    print(report)
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a") as f:
            f.write("### What this scraper run changed\n\n" + report + "\n\nFull list: the changes.csv artifact.\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("snapshot", "changes"))
    parser.add_argument("--label", required=True)
    parser.add_argument("--out", default="output")
    args = parser.parse_args(argv)
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required.")
    if args.command == "snapshot":
        counts = snapshot(url, args.label)
        print("Snapshot saved:", ", ".join(f"{t} {n}" for t, n in counts.items()))
    else:
        lines, summary = changes(url, args.label)
        write_changes(lines, summary, args.out)


if __name__ == "__main__":
    main()
