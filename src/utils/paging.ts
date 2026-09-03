/** PostgREST caps a single response at 1000 rows server-side, regardless of
 *  whether the query asks for a limit. Anything larger must be paged. */
export const PAGE_SIZE = 1000;

/**
 * Repeatedly calls `fetchPage` with successive ranges until a short page
 * signals the end, accumulating every row.
 *
 * Kept free of the Supabase client so the paging behaviour can be exercised
 * directly — an unpaged read looks identical to a paged one right up until the
 * table passes the cap, which is exactly when nobody is watching.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await fetchPage(from, from + pageSize - 1);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
