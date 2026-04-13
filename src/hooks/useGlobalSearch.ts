import { useMemo } from 'react';
import type { School, Contact, Event } from '../types';

interface SearchData {
  schools: School[];
  contacts: Contact[];
  events: Event[];
}

interface SearchResults {
  schools: School[];
  contacts: Contact[];
  events: Event[];
}

export function useGlobalSearch(query: string, data: SearchData): SearchResults {
  return useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return { schools: [], contacts: [], events: [] };

    const schools = data.schools
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.county.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          (s.district ?? '').toLowerCase().includes(q)
      )
      .slice(0, 5);

    const contacts = data.contacts
      .filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
      )
      .slice(0, 5);

    const events = data.events
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q)
      )
      .slice(0, 5);

    return { schools, contacts, events };
  }, [query, data.schools, data.contacts, data.events]);
}
