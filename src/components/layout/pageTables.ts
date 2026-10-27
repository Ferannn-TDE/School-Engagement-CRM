import { matchPath } from 'react-router-dom';
import type { DataTable } from '../../context/AppContext';

const ALL: DataTable[] = ['schools', 'contacts', 'events', 'activities', 'programs'];

/**
 * The startup tables each page reads, directly or through its components and hooks.
 * When one of them fails to load, the page shows a retry message instead of treating
 * the missing table as empty (an empty contacts list would let Import add duplicates,
 * and Settings' export would save an incomplete copy). Pages not listed need all five.
 */
const PAGE_TABLES: [pattern: string, tables: DataTable[]][] = [
  ['/', ['schools', 'contacts', 'events', 'activities']],
  ['/priorities', ['schools', 'contacts', 'events', 'activities']],
  ['/schools', ['schools', 'contacts', 'activities']],
  ['/schools/:id', ALL],
  ['/contacts', ['schools', 'contacts']],
  ['/events', ['schools', 'events']],
  ['/generate', ['schools', 'contacts', 'events']],
  ['/reports', ['schools', 'contacts', 'events', 'activities']],
  ['/counties', ALL],
  ['/counties/:countyName', ALL],
  ['/counties/:state/:countyName', ALL],
  // Import Activities checks for duplicate activities and lists events to link.
  ['/import', ['schools', 'contacts', 'events', 'activities']],
  ['/settings', ['schools', 'contacts', 'events', 'activities']],
  // Reads the database itself, so it works whatever failed at startup.
  ['/settings/archived', []],
  ['/settings/problem-reports', []],
  ['/settings/team', []],
  ['/analytics', []],
];

export function tablesForPath(pathname: string): DataTable[] {
  const hit = PAGE_TABLES.find(([pattern]) => matchPath(pattern, pathname));
  return hit ? hit[1] : ALL;
}
