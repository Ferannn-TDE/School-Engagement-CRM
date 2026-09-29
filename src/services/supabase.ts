import { createClient } from '@supabase/supabase-js';
import { collectPages, PAGE_SIZE } from '../utils/paging';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export { PAGE_SIZE };

export async function fetchAllRows<T>(
  table: string,
  orderBy: string | string[],
  select = '*',
  /** Column = value filters, e.g. { archived: false } to leave archived rows out. */
  where: Record<string, string | number | boolean> = {}
): Promise<T[]> {
  const orderCols = Array.isArray(orderBy) ? orderBy : [orderBy];

  return collectPages<T>(async (from, to) => {
    let query = supabase.from(table).select(select).range(from, to);
    for (const [col, value] of Object.entries(where)) {
      query = query.eq(col, value);
    }
    for (const col of orderCols) {
      query = query.order(col, { ascending: true });
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as T[];
  });
}
