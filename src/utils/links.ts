import type { School } from '../types';

// Which link the app uses for a school (db/013): the client's own, if set, otherwise
// what the scraper found. The scraper doesn't store staff pages, only looks for them.

export interface LinkInUse {
  url: string | null;
  source: 'yours' | 'scraper' | null;
}

export function websiteInUse(school: School): LinkInUse {
  if (school.websiteOverride) return { url: school.websiteOverride, source: 'yours' };
  if (school.website) return { url: school.website, source: 'scraper' };
  return { url: null, source: null };
}

export function staffPageInUse(school: School): LinkInUse {
  return school.staffPageOverride
    ? { url: school.staffPageOverride, source: 'yours' }
    : { url: null, source: null };
}

/**
 * Turns what someone pasted into a link the database accepts: trims it, adds
 * https:// when there is no scheme, and rejects anything that isn't a web address.
 * Returns null for blank (no override), or throws with a message to show.
 */
export function normalizeLink(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${text}" isn't a web address`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links can be used');
  }
  if (/\s/.test(withScheme) || !url.hostname.includes('.')) {
    throw new Error(`"${text}" isn't a web address`);
  }
  return withScheme;
}
