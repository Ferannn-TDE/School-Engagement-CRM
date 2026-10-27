/**
 * The lists behind the Reports page's figures: every number opens the rows it
 * counts (schools, logged activities, events or contacts), with a CSV download.
 * The rows come from the same id lists the figures are counted from (utils/reports),
 * so a list always has exactly as many rows as its number says.
 */
import type { ActivityRecord, Contact, Event, School } from '../types';
import { ContactMethodLabels } from '../types';
import { EVENT_ATTENDANCE_TYPE } from '../constants/reportSettings';
import { dayOf, formatDay, type Day, type ReportInput } from './reports';

export interface ListColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface ListRow {
  cells: Record<string, string | number>;
  /** Where the row opens in the app, if anywhere. */
  link?: string;
}

export interface ListSpec {
  title: string;
  subtitle: string;
  /** The CSV file's name, without ".csv". */
  filename: string;
  columns: ListColumn[];
  rows: ListRow[];
}

/** "1 phone call", "3 visits", "2 attendance rows". */
export function activityCount(type: string, n: number): string {
  const label = type === EVENT_ATTENDANCE_TYPE ? 'attendance row' : activityTypeLabel(type).toLowerCase();
  return `${n.toLocaleString('en-US')} ${label}${n === 1 ? '' : 's'}`;
}

export function activityTypeLabel(type: string): string {
  if (type === EVENT_ATTENDANCE_TYPE) return 'Event attendance';
  return ContactMethodLabels[type] ?? type.replace(/_/g, ' ');
}

export const fmt = (n: number) => n.toLocaleString('en-US');
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
/** A share as text: "92%", or "under 1%" when it's more than nothing but rounds to 0. */
export const pctText = (part: number, whole: number) => (part > 0 && pct(part, whole) === 0 ? 'under 1%' : `${pct(part, whole)}%`);

const schoolLink = (id: string) => `/schools/${encodeURIComponent(id)}`;

/** Builders for each kind of list, with the lookups they need made once. */
export function listBuilders(data: ReportInput, asOf: Day) {
  const schools = new Map<string, School>(data.schools.map((s) => [s.id, s]));
  const events = new Map<string, Event>(data.events.map((e) => [e.id, e]));
  const activities = new Map<string, ActivityRecord>(data.activities.map((a) => [a.id, a]));
  const contacts = new Map<string, Contact>(data.contacts.map((c) => [c.id, c]));
  const activeContacts = new Map<string, number>();
  for (const c of data.contacts) if (c.isActive) activeContacts.set(c.schoolId, (activeContacts.get(c.schoolId) ?? 0) + 1);
  const lastActivity = new Map<string, Day>();
  for (const a of data.activities) {
    const d = dayOf(a.date);
    if (d > asOf) continue;
    const seen = lastActivity.get(a.schoolId);
    if (!seen || d > seen) lastActivity.set(a.schoolId, d);
  }
  const schoolName = (id: string) => schools.get(id)?.name ?? id;

  return {
    schools(ids: string[], title: string, subtitle: string, filename: string): ListSpec {
      return {
        title, subtitle, filename,
        columns: [
          { key: 'school', label: 'School' }, { key: 'county', label: 'County' }, { key: 'state', label: 'State' },
          { key: 'contacts', label: 'Active contacts', numeric: true }, { key: 'last', label: 'Last activity' },
        ],
        rows: ids.map((id) => schools.get(id)).filter((s): s is School => !!s)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => ({
            link: schoolLink(s.id),
            cells: {
              school: s.name, county: s.county.trim() || '(no county)', state: s.state,
              contacts: activeContacts.get(s.id) ?? 0,
              last: lastActivity.has(s.id) ? formatDay(lastActivity.get(s.id)!) : 'Never',
            },
          })),
      };
    },

    activities(ids: string[], title: string, subtitle: string, filename: string): ListSpec {
      return {
        title, subtitle, filename,
        columns: [
          { key: 'date', label: 'Date' }, { key: 'school', label: 'School' }, { key: 'type', label: 'Type' },
          { key: 'event', label: 'Event' }, { key: 'students', label: 'Students', numeric: true },
        ],
        rows: ids.map((id) => activities.get(id)).filter((a): a is ActivityRecord => !!a)
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .map((a) => ({
            link: schoolLink(a.schoolId),
            cells: {
              date: formatDay(dayOf(a.date)), school: schoolName(a.schoolId), type: activityTypeLabel(a.activityType),
              event: a.eventId ? events.get(a.eventId)?.name ?? '' : '', students: a.importBatchId && a.attendeeCount ? a.attendeeCount : '',
            },
          })),
      };
    },

    events(ids: string[], title: string, subtitle: string, filename: string): ListSpec {
      return {
        title, subtitle, filename,
        columns: [
          { key: 'date', label: 'Date' }, { key: 'event', label: 'Event' }, { key: 'location', label: 'Location' },
          { key: 'schools', label: 'Schools listed' },
        ],
        rows: ids.map((id) => events.get(id)).filter((e): e is Event => !!e).map((e) => ({
          cells: {
            date: formatDay(dayOf(e.date)), event: e.name, location: e.location,
            schools: e.participatingSchools.map(schoolName).join('; '),
          },
        })),
      };
    },

    contacts(ids: string[], title: string, subtitle: string, filename: string): ListSpec {
      return {
        title, subtitle, filename,
        columns: [
          { key: 'name', label: 'Name' }, { key: 'title', label: 'Title' }, { key: 'school', label: 'School' },
          { key: 'verified', label: 'Last verified' },
        ],
        rows: ids.map((id) => contacts.get(id)).filter((c): c is Contact => !!c)
          .sort((a, b) => schoolName(a.schoolId).localeCompare(schoolName(b.schoolId)) || a.lastName.localeCompare(b.lastName))
          .map((c) => ({
            link: schoolLink(c.schoolId),
            cells: {
              name: `${c.firstName} ${c.lastName}`.trim(), title: c.title ?? '', school: schoolName(c.schoolId),
              verified: c.lastVerifiedAt ? formatDay(dayOf(c.lastVerifiedAt)) : 'Never',
            },
          })),
      };
    },
  };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The list as CSV, with a byte-order mark so Excel reads accents correctly. */
export function listToCsv(list: ListSpec): string {
  const lines = [list.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of list.rows) lines.push(list.columns.map((c) => csvCell(row.cells[c.key] ?? '')).join(','));
  return '﻿' + lines.join('\r\n');
}
