"""Fail-closed checks for the client's existing db/012 edit protection.

This module does not install or modify database functions, triggers or tables.
The reviewed function fingerprint permits whitespace and SQL comment differences.
A different implementation requires review before this scraper can upload.
"""
import hashlib
import re

EXPECTED_FUNCTION = "48c4ba9ba47750a4fe55dbd86385709e7a331294019ed045ca116c092b368003"
PROTECTED_FIELDS = {
    "schools": {"name", "phone", "address", "type_of_school", "admin", "city",
                "zipcode", "grades_served", "website", "county_name", "is_active",
                "notes", "enrollment", "grade_range", "priority_tier", "state_code"},
    "staff": {"name", "phone", "email", "job_name", "school_worked_at", "is_active", "notes"},
}
PROTECTION_SQL = """
SELECT c.relname, t.tgenabled, t.tgtype, t.tgargs, p.prosrc,
       t.tgqual IS NULL, cardinality(t.tgattr::smallint[]) = 0
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid IN ('schools'::regclass, 'staff'::regclass)
  AND t.tgname = 'protect_manual_edits' AND NOT t.tgisinternal
"""
CONTEXT_SQL = """
SELECT current_setting('session_replication_role'),
       coalesce(current_setting('request.jwt.claims', true), '')
"""
STATE_SQL = "INSERT INTO state (state_code, state_name) VALUES (%s, %s) ON CONFLICT DO NOTHING"
COUNTY_SQL = "INSERT INTO county (county_name, state_code) VALUES (%s, %s) ON CONFLICT DO NOTHING"
CONTACT_SQL = "INSERT INTO contacts (school_id, staff_id) VALUES (%s, %s) ON CONFLICT DO NOTHING"


def function_fingerprint(body):
    tokens = re.findall(r"'(?:''|[^'])*'|[a-zA-Z_][a-zA-Z_0-9]*|\S",
                        re.sub(r"--[^\n]*", "", body))
    return hashlib.sha256("\x1f".join(
        t if t.startswith("'") else t.lower() for t in tokens
    ).encode()).hexdigest()


def verify_protection(cursor):
    # Keep trigger DDL from racing this transaction; ordinary client DML can proceed.
    cursor.execute("SET LOCAL lock_timeout = '5s'")
    cursor.execute("LOCK TABLE schools, staff IN ROW EXCLUSIVE MODE")
    cursor.execute(CONTEXT_SQL)
    context = cursor.fetchone()
    if not context or context[0] not in ("origin", "local") or context[1]:
        raise RuntimeError("Upload stopped: use a direct scraper connection with edit triggers enabled and no app JWT claims.")
    cursor.execute(PROTECTION_SQL)
    protected = set()
    for table, enabled, kind, args, body, unconditional, all_columns in cursor.fetchall():
        fields = set(bytes(args).decode().rstrip("\0").split("\0"))
        if (enabled in ("O", "A") and kind == 19 and unconditional and all_columns
                and PROTECTED_FIELDS[table] <= fields
                and function_fingerprint(body) == EXPECTED_FUNCTION):
            protected.add(table)
    if protected != set(PROTECTED_FIELDS):
        raise RuntimeError(
            "Upload stopped: schools/staff require the reviewed db/012 protect_manual_edits "
            "triggers and field lists. No scraper data was committed. Have the database owner "
            "check the existing migrations; do not bypass this check."
        )
