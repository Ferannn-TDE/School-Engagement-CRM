// Matches the rows of an activity-import file (school name, city, state) to schools.
// The rules are the ones agreed in the 20 Oct design session and checked against the
// client's Book10.xlsx in the dry run on the plan page:
//
//   * Names are cleaned (case, punctuation, "O Fallon", St./Sr./Jr./HS/… spelled out)
//     and only the distinctive words are scored: words every school shares (high,
//     school, senior, community, …) are dropped. "Junior" is kept, so "Bloomington High
//     School" can't tie with "Bloomington Jr High School".
//   * Two scores, both needed for Matched: token-set (ignores extra words) and
//     token-sort (order-aware, penalises them), each at least 0.92, the school in the
//     file's state, and no runner-up within 0.05. Anything weaker is Suggested and never
//     picked automatically.
//   * State ranks schools; city only breaks ties. A best match in the other state is
//     always Suggested, with a warning.
//   * K-12 first: a row is "Not a K-12 school" only when it names a college, university
//     or online school AND no school of that kind matches. "College" followed by
//     "High" or "Prep" doesn't count, so Christian Brothers College High School stays a
//     school.

export interface MatchSchool {
  id: string;
  name: string;
  city: string;
  state: string;
  archived?: boolean;
}

export interface MatchCandidate {
  school: MatchSchool;
  /** 0.4 × set + 0.6 × sort */
  score: number;
  set: number;
  sort: number;
  /** score plus the same-state and same-city bonuses; candidates are ordered by it. */
  rank: number;
}

export type RowOutcome =
  | 'matched'
  | 'suggested'
  | 'not_k12'
  | 'not_found'
  | 'not_a_school'
  | 'header'
  | 'blank';

export interface FileRow {
  /** Spreadsheet row number, 1-based. */
  row: number;
  name: string;
  city: string;
  state: string;
}

export interface RowMatch extends FileRow {
  outcome: RowOutcome;
  /** Why a row isn't Matched, or why it's Not a K-12 school. */
  reasons: string[];
  /** Up to three, best first. */
  candidates: MatchCandidate[];
  /** For Matched rows: the file's name and the school's clean to the same words. */
  identical?: boolean;
}

const EXPAND: Record<string, string> = {
  st: 'saint', sr: 'senior', jr: 'junior', hs: 'high school', sch: 'school', dr: 'doctor',
  mt: 'mount', ft: 'fort', comm: 'community', twp: 'township', prep: 'preparatory',
  l: 'luther', ctr: 'center',
};

const GENERIC = new Set([
  'the', 'of', 'and', 'high', 'school', 'senior', 'community', 'township', 'attendance',
  'center', 'h', 's', '9', '12', 'unit',
]);

const KIND =
  /\b(community colleges?|junior college|colleges?(?! (high|prep|preparatory))|university|penn foster|connections academy|online|virtual)\b/i;

const PLACEHOLDERS = new Set(['none', 'international', 'n/a', 'na', 'unknown', 'homeschool', 'home school']);
const HEADER_NAMES = new Set(['name', 'school', 'school name', 'school_name']);

export const MATCH_THRESHOLD = 0.92;
const MIN_SCORE = 0.6;
const MIN_SORT = 0.5;
const RUNNER_UP_GAP = 0.05;
const SAME_STATE_BONUS = 0.08;
const SAME_CITY_BONUS = 0.01;

/** Cleaned words of a name, with abbreviations spelled out. */
export function nameTokens(name: string): string[] {
  let s = name.toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/\bo (?=fallon)/g, 'o');
  return s.split(' ').filter(Boolean).flatMap((t) => (EXPAND[t] ?? t).split(' '));
}

/** The distinctive words: generic school words removed. */
export function coreTokens(name: string): string[] {
  return nameTokens(name).filter((t) => !GENERIC.has(t));
}

// ── Similarity: Python's difflib.SequenceMatcher(None, a, b).ratio() ───────────────
// Ported exactly (no junk; difflib's autojunk only applies to strings of 200+
// characters), so these scores equal the ones in the dry run.

function longestMatch(a: string, b2j: Map<string, number[]>, alo: number, ahi: number, blo: number, bhi: number) {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      next.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = next;
  }
  return [besti, bestj, bestsize] as const;
}

export function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const list = b2j.get(b[j]);
    if (list) list.push(j);
    else b2j.set(b[j], [j]);
  }
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longestMatch(a, b2j, alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / total;
}

const sortedJoin = (words: Iterable<string>) => [...words].sort().join(' ');

/** Order-aware: both word lists sorted, then compared as strings. */
export function tokenSort(a: string[], b: string[]): number {
  return ratio(sortedJoin(a), sortedJoin(b));
}

/** Ignores extra words: the shared words compared with each side's full set. */
export function tokenSet(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const both = sortedJoin([...A].filter((t) => B.has(t)));
  const onlyA = sortedJoin([...A].filter((t) => !B.has(t)));
  const onlyB = sortedJoin([...B].filter((t) => !A.has(t)));
  const s1 = `${both} ${onlyA}`.trim();
  const s2 = `${both} ${onlyB}`.trim();
  return Math.max(both ? ratio(both, s1) : 0, both ? ratio(both, s2) : 0, ratio(s1, s2));
}

interface IndexedSchool {
  school: MatchSchool;
  core: string[];
  coreSet: Set<string>;
  cityKey: string;
}

export function indexSchools(schools: MatchSchool[]): IndexedSchool[] {
  return schools.map((school) => {
    const core = coreTokens(school.name);
    return { school, core, coreSet: new Set(core), cityKey: school.city.toLowerCase().replace(/'/g, '') };
  });
}

function candidatesFor(row: FileRow, index: IndexedSchool[]): MatchCandidate[] {
  const q = coreTokens(row.name);
  const state = row.state.toUpperCase();
  const city = row.city.toLowerCase();
  const out: MatchCandidate[] = [];
  for (const s of index) {
    if (!q.some((t) => s.coreSet.has(t))) continue; // must share a distinctive word
    const set = tokenSet(q, s.core);
    const sort = tokenSort(q, s.core);
    const score = 0.4 * set + 0.6 * sort;
    if (score < MIN_SCORE || sort < MIN_SORT) continue;
    const rank = score + (s.school.state === state ? SAME_STATE_BONUS : 0) + (s.cityKey === city ? SAME_CITY_BONUS : 0);
    out.push({ school: s.school, score, set, sort, rank });
  }
  // Stable sort, as Python's: equal ranks keep the schools list's order.
  return out.sort((x, y) => y.rank - x.rank).slice(0, 3);
}

/** What one file row becomes in the preview. */
export function matchRow(row: FileRow, index: IndexedSchool[]): RowMatch {
  const base = { ...row, reasons: [] as string[], candidates: [] as MatchCandidate[] };
  const name = row.name.trim();
  const lower = name.toLowerCase();
  if (!name && !row.city.trim() && !row.state.trim()) return { ...base, outcome: 'blank' };
  if (HEADER_NAMES.has(lower) && ['city', ''].includes(row.city.trim().toLowerCase())) {
    return { ...base, outcome: 'header' };
  }
  if (!name || PLACEHOLDERS.has(lower)) return { ...base, outcome: 'not_a_school' };

  const top = candidatesFor(row, index);
  const kind = KIND.exec(name);
  const state = row.state.toUpperCase();

  if (kind) {
    const phrase = nameTokens(kind[0]).join(' ').replace(/s+$/, '');
    if (!top.length) {
      return { ...base, candidates: top, outcome: 'not_k12', reasons: [`"${kind[0]}" and no match`] };
    }
    if (!nameTokens(top[0].school.name).join(' ').includes(phrase)) {
      return { ...base, candidates: top, outcome: 'not_k12', reasons: [`"${kind[0]}" and no school of that kind in the list`] };
    }
  }
  if (!top.length) return { ...base, outcome: 'not_found' };

  const best = top[0];
  const gap = best.rank - (top[1]?.rank ?? 0);
  const reasons: string[] = [];
  if (best.school.state !== state) reasons.push(`file says ${state || 'no state'}, school is in ${best.school.state}`);
  if (!(best.set >= MATCH_THRESHOLD && best.sort >= MATCH_THRESHOLD)) reasons.push('names differ');
  if (gap < RUNNER_UP_GAP) reasons.push(`close runner-up (${top[1].school.name})`);
  return {
    ...base,
    candidates: top,
    outcome: reasons.length ? 'suggested' : 'matched',
    reasons,
    identical: nameTokens(name).join(' ') === nameTokens(best.school.name).join(' '),
  };
}

export function matchRows(rows: FileRow[], schools: MatchSchool[]): RowMatch[] {
  const index = indexSchools(schools);
  return rows.map((row) => matchRow(row, index));
}

/** False when the file holds only header and blank rows (e.g. the empty template). */
export function hasSchoolRows(results: RowMatch[]): boolean {
  return results.some((r) => r.outcome !== 'header' && r.outcome !== 'blank');
}

/**
 * The search box for rows the scores can't place: every word typed must start a word
 * of the school's name (or its city). Schools in `preferState` come first.
 */
export function searchSchools(query: string, schools: MatchSchool[], preferState = '', limit = 8): MatchSchool[] {
  const words = nameTokens(query);
  if (!words.length) return [];
  const state = preferState.toUpperCase();
  return schools
    .filter((s) => {
      const own = [...nameTokens(s.name), ...nameTokens(s.city)];
      return words.every((w) => own.some((t) => t.startsWith(w)));
    })
    .sort((a, b) => Number(b.state === state) - Number(a.state === state) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
