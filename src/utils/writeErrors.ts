// Turning a failed database write into a plain-English reason. Every save in the app
// reports through writeErrorMessage, so "Failed to save event" always says why: the
// role explanation for code 42501 (db/023 "Editors add" / "Editors change"), and for
// anything else the reason in words, never a bare "Failed to save".

export const NO_EDIT_ACCESS =
  'Your account can view but not change data. Ask an admin (Settings → Team) for editor access.';

interface DbError {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

export function isPermissionError(err: unknown): boolean {
  return (err as DbError | null)?.code === '42501';
}

/** Table names as people say them. */
const THING: Record<string, string> = {
  schools: 'school',
  staff: 'contact',
  contacts: 'contact',
  events: 'event',
  event_schools: 'school on the event',
  activities: 'logged contact',
  programs: 'program',
  import_batches: 'import',
  import_rows: 'import row',
  district: 'district',
  county: 'county',
  state: 'state',
};

/** Columns as people say them, for "required" and "too long" messages. */
const FIELD: Record<string, string> = {
  fair_name: 'event name',
  name: 'name',
  email: 'email',
  phone: 'phone',
  date: 'date',
  activity_date: 'date',
  activity_type: 'type',
  event_type_other: '"Please specify"',
  activity_type_other: '"Please specify"',
  school_id: 'school',
  facility_key: 'school',
};

/** Known CHECK constraints, in words. */
const CHECKS: Array<[RegExp, string]> = [
  [/event_type/, 'the event type isn’t one of the listed types'],
  [/attendee_count|visitors|attendance/, 'counts must be a whole number of at least 1'],
  [/file_hash/, 'the file’s fingerprint is not valid; upload the file again'],
  [/row_number/, 'a row number is not valid'],
];

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Why the write failed, in plain words (no trailing full stop). */
export function writeErrorReason(err: unknown): string {
  const e = (err ?? {}) as DbError;
  const code = str(e.code);
  const message = str(e.message) || (err instanceof Error ? err.message : '');
  const details = str(e.details);

  if (code === '42501') return NO_EDIT_ACCESS.replace(/\.$/, '');
  if (code === 'APP031') return message.replace(/\.$/, '');

  // The browser couldn't reach the database at all.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'the database couldn’t be reached. Check your internet connection and try again';
  }
  // Signed out or the session ran out.
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired|invalid jwt/i.test(message)) {
    return 'your sign-in has expired. Sign in again, then retry';
  }

  switch (code) {
    case '23503': {
      // e.g. Key (school_id)=(X) is not present in table "schools".
      if (/still referenced/i.test(details)) {
        // The row being changed is the table in the message, not the one in the details.
        const own = message.match(/on table "([^"]+)"/)?.[1] ?? details.match(/\(([a-z_]+)_id\)/)?.[1] + 's';
        return `other records still point to this ${THING[own] ?? 'record'}`;
      }
      const table = details.match(/table "([^"]+)"/)?.[1] ?? '';
      const thing = THING[table] ?? 'record';
      return `it refers to a ${thing} that isn’t in the database (it may have been archived). Refresh the page and try again`;
    }
    case '23505':
      return 'the same record already exists, so it wasn’t added twice';
    case '23514': {
      const known = CHECKS.find(([re]) => re.test(message));
      return known ? known[1] : 'one of the values isn’t allowed';
    }
    case '23502': {
      const col = message.match(/column "([^"]+)"/)?.[1] ?? '';
      return `${FIELD[col] ?? 'a required field'} is empty and must be filled in`;
    }
    case '22001':
      return 'one of the fields is longer than allowed. Shorten it and try again';
    case '22P02':
      return 'one of the values is in the wrong format (for example a number or a date)';
    case '22007':
    case '22008':
      return 'a date or time isn’t valid';
    case '22003':
      return 'a number is too large';
    case 'P0001':
      // Our own database functions raise plain sentences; pass them on.
      return message.replace(/\.$/, '');
    case 'PGRST116':
      return 'the record wasn’t found. It may have been archived; refresh the page';
    case 'PGRST202':
    case 'PGRST205':
    case '42P01':
    case '42883':
      return 'the database is missing an update this screen needs. Ask the admin to apply the latest database migration';
    case '57014':
      return 'the database took too long to answer. Try again in a moment';
  }
  if (message) return `the database said: ${message.replace(/\.$/, '')}`;
  return 'something went wrong that the database didn’t explain. Try again, and use Report a problem if it keeps happening';
}

/**
 * The message to show for a failed write: the role explanation for a viewer, or
 * `fallback` followed by the reason, e.g. "Failed to save event: it refers to a school
 * that isn’t in the database…".
 */
export function writeErrorMessage(err: unknown, fallback: string): string {
  if (isPermissionError(err)) return NO_EDIT_ACCESS;
  return `${fallback.replace(/\.$/, '')}: ${writeErrorReason(err)}.`;
}

/** A database error's own message, e.g. "There must always be at least one admin". */
export function databaseMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(err);
}
