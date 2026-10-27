// The database refuses a write from an account without edit access (db/023: the
// restrictive "Editors add" / "Editors change" policies) with code 42501. Say so plainly
// instead of a generic "Failed to save".

export const NO_EDIT_ACCESS =
  'Your account can view but not change data. Ask an admin (Settings → Team) for editor access.';

export function isPermissionError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '42501';
}

/** The message to show for a failed write: the role explanation, or `fallback`. */
export function writeErrorMessage(err: unknown, fallback: string): string {
  return isPermissionError(err) ? NO_EDIT_ACCESS : fallback;
}

/** A database error's own message, e.g. "There must always be at least one admin". */
export function databaseMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(err);
}
