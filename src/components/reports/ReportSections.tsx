import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MIN_MONTHS_FOR_TREND, FOLLOW_UP_DAYS, QUIET_MONTHS, VERIFIED_RECENT_MONTHS, EVENT_ATTENDANCE_TYPE } from '../../constants/reportSettings';
import { REPORT_SERIES, REPORT_QUIET } from '../../constants/charts';
import {
  formatDay, formatMonth, monthOf, addMonths, type ActivitySummary, type Comparison, type ContactCoverage, type DataHealth,
  type Day, type EventImpact, type EventSummary, type Gaps, type LoggingStatus, type Monthly, type Reach, type ReportInput, type ReportRange,
} from '../../utils/reports';
import { activityCount, activityTypeLabel, fmt, pctText, type ListSpec, listBuilders } from '../../utils/reportLists';
import type { Region } from '../../utils/region';
import { Columns, Figure, Meter, Note, ReportSection, Tile, Tiles } from './ReportParts';

export interface ReportModel {
  data: ReportInput;
  region: Region;
  range: ReportRange;
  today: Day;
  comparison: Comparison;
  /** Logging across every state: when it started, and in how many months. */
  logging: LoggingStatus & { monthsWithData: number };
  reach: Reach;
  reachBefore: Reach | null;
  activity: ActivitySummary;
  activityBefore: ActivitySummary | null;
  monthly: Monthly;
  coverage: ContactCoverage;
  events: EventSummary;
  impact: EventImpact[];
  gaps: Gaps;
  health: DataHealth;
  lists: ReturnType<typeof listBuilders>;
  open: (list: ListSpec) => void;
}

const STATE_NAMES: Record<string, string> = { IL: 'Illinois', MO: 'Missouri' };
const placeName = (region: Region) => (region ? STATE_NAMES[region] : 'Illinois and Missouri');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "▲ 3 vs 5 in the same dates last year", or the reason there's no comparison. */
function compare(now: number, before: number | null, comparison: Comparison) {
  if (before === null) return comparison.label;
  const diff = now - before;
  return (
    <>
      <span className={diff >= 0 ? 'text-success font-semibold' : 'text-attention-high-text font-semibold'}>
        {diff >= 0 ? '▲' : '▼'} {fmt(Math.abs(diff))}
      </span>{' '}
      vs {fmt(before)} in {comparison.label}
    </>
  );
}

function CountyTable({ rows, cols }: {
  rows: { key: string; name: string; cells: ReactNode[] }[];
  cols: string[];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100">
              <th className="text-left px-2 py-1.5 text-xs font-medium text-neutral-500">County</th>
              {cols.map((c) => <th key={c} className="text-right px-2 py-1.5 text-xs font-medium text-neutral-500 whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b border-neutral-50 last:border-0">
                <td className="px-2 py-1.5 text-neutral-700">{r.name}</td>
                {r.cells.map((c, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="text-sm font-medium text-siue-red hover:text-siue-maroon">
          {all ? 'Show the first 10' : `Show all ${fmt(rows.length)} counties`}
        </button>
      )}
    </div>
  );
}

// ── Getting started (admins) ────────────────────────────────────────────────────

export function GettingStarted({ steps }: { steps: { title: string; status: string; link?: { to: string; label: string }; done: boolean }[] }) {
  const open = steps.filter((s) => !s.done);
  if (!open.length) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3" aria-label="Getting started">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-neutral-800">Getting started: what will fill this page</h2>
        <p className="text-xs text-neutral-500">Shown to admins; each step disappears once it's done</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {open.map((s) => (
          <div key={s.title} className="bg-white rounded-lg border border-neutral-100 p-3.5 space-y-1.5">
            <p className="font-semibold text-neutral-800 text-sm">{s.title}</p>
            <p className="text-xs text-neutral-600">{s.status}</p>
            {s.link && <Link to={s.link.to} className="inline-block text-sm font-semibold text-siue-red hover:text-siue-maroon">{s.link.label} →</Link>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 1. Contact coverage ─────────────────────────────────────────────────────────

export function CoverageSection({ m }: { m: ReportModel }) {
  const { coverage: c, lists, open, region } = m;
  const total = m.reach.totalSchools;
  const withN = c.withIds.length, without = c.withoutIds.length, one = c.buckets['1'].length;
  const buckets = ['0', '1', '2-5', '6-15', '16+'];
  return (
    <ReportSection
      label="Contact coverage"
      question="Do we have someone to contact at every school?"
      takeaway={total ? <>
        <b>{fmt(withN)} of {plural(total, 'school')}</b> ({pctText(withN, total)}) in {placeName(region)} have at least one active contact
        {one ? <>, but <b>{fmt(one)} of them have only one</b></> : null}. {without ? <><b>{plural(without, 'school')}</b> {without === 1 ? 'has' : 'have'} none.</> : 'Every school has one.'}
      </> : 'No schools in this state.'}
      source="contacts (not archived) on each listed school, by their contacts-table school or else staff.school_worked_at; active unless marked inactive."
    >
      <Tiles>
        <Tile hero label="Schools with a contact" of={`of ${fmt(total)}`}
          value={<Figure value={withN} onOpen={open} list={() => lists.schools(c.withIds, 'Schools with an active contact', placeName(region), 'schools-with-a-contact')} />} />
        <Tile label="Schools with no contact" note="The ones to find a name for first"
          value={<Figure value={without} onOpen={open} list={() => lists.schools(c.withoutIds, 'Schools with no active contact', placeName(region), 'schools-with-no-contact')} />} />
        <Tile label="Active contacts" note={total ? `${(c.activeContactIds.length / total).toFixed(1)} per school on average` : undefined}
          value={<Figure value={c.activeContactIds.length} onOpen={open} list={() => lists.contacts(c.activeContactIds, 'Active contacts', placeName(region), 'active-contacts')} />} />
      </Tiles>
      <div className="space-y-1">
        <p className="text-xs text-neutral-500">Schools by number of active contacts</p>
        <Columns
          ariaLabel="Schools by number of active contacts"
          rows={buckets.map((b) => ({ bucket: b === '1' ? '1 contact' : `${b} contacts`, schools: c.buckets[b].length }))}
          xKey="bucket"
          series={[{ key: 'schools', label: 'Schools', color: REPORT_SERIES[0] }]}
          colorFor={(i) => (i === 0 ? REPORT_SERIES[1] : REPORT_SERIES[0])}
          onPick={(i) => open(lists.schools(c.buckets[buckets[i]], `Schools with ${buckets[i]} active contact${buckets[i] === '1' ? '' : 's'}`, placeName(region), `schools-${slug(buckets[i])}-contacts`))}
        />
      </div>
      {!region && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">Share with a contact, by state</p>
          {Object.entries(c.byState).sort().map(([st, s]) => (
            <Meter key={st} label={`${STATE_NAMES[st] ?? st} · ${fmt(s.total)} schools`} part={s.total - s.withoutIds.length} whole={s.total}
              figure={<><Figure value={s.total - s.withoutIds.length} onOpen={open}
                list={() => lists.schools(m.data.schools.filter((x) => x.state === st && !s.withoutIds.includes(x.id)).map((x) => x.id), `Schools with a contact in ${STATE_NAMES[st] ?? st}`, 'Active contacts', `schools-with-a-contact-${st.toLowerCase()}`)} />
                {' '}of {fmt(s.total)} · {pctText(s.total - s.withoutIds.length, s.total)}</>} />
          ))}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-neutral-500">Counties, lowest share with a contact first</p>
        <CountyTable
          cols={['Schools', 'No contact']}
          rows={c.byCounty.map((x) => ({
            key: `${x.state}|${x.county}`, name: `${x.county}, ${x.state}`,
            cells: [fmt(x.schoolIds.length),
              <Figure key="n" value={x.withoutIds.length} onOpen={open} list={() => lists.schools(x.withoutIds, `No contact in ${x.county}, ${x.state}`, 'Schools with no active contact', `no-contact-${slug(x.county)}-${x.state.toLowerCase()}`)} />],
          }))}
        />
      </div>
    </ReportSection>
  );
}

// ── 2. Upcoming events ──────────────────────────────────────────────────────────

export function UpcomingSection({ m }: { m: ReportModel }) {
  const { events: e, lists, open, today } = m;
  const months: string[] = [];
  const keys = Object.keys(e.upcomingByMonth).sort();
  if (keys.length) for (let k = keys[0]; k <= keys[keys.length - 1]; k = monthOf(addMonths(`${k}-01`, 1))) months.push(k);
  const counts = months.map((k) => e.upcomingByMonth[k] ?? 0);
  const busiest = counts.length ? months[counts.indexOf(Math.max(...counts))] : null;
  const in30 = e.upcomingIds.filter((id) => {
    const ev = m.data.events.find((x) => x.id === id);
    return ev ? ev.date.slice(0, 10) <= addMonths(today, 1) : false;
  });
  return (
    <ReportSection
      label="Coming up"
      question="What outreach events are coming, and when?"
      takeaway={e.upcomingIds.length ? <>
        <b>{plural(e.upcomingIds.length, 'outreach event')}</b> {e.upcomingIds.length === 1 ? 'is' : 'are'} on the calendar from today
        {busiest && counts.length > 1 ? <>; the busiest month is <b>{formatMonth(busiest)}</b>, with {fmt(e.upcomingByMonth[busiest])}</> : null}. {fmt(in30.length)} {in30.length === 1 ? 'falls' : 'fall'} in the next month.
      </> : 'No outreach events are on the calendar from today.'}
      source="events (not archived; testing dates left out) dated today or later, from school calendars, IACAC and events entered in the app."
    >
      <Tiles>
        <Tile hero label="Upcoming events"
          value={<Figure value={e.upcomingIds.length} onOpen={open} list={() => lists.events(e.upcomingIds, 'Upcoming outreach events', `From ${formatDay(today)}`, 'upcoming-events')} />} />
        <Tile label="In the next month" note={`To ${formatDay(addMonths(today, 1))}`}
          value={<Figure value={in30.length} onOpen={open} list={() => lists.events(in30, 'Events in the next month', `${formatDay(today)} to ${formatDay(addMonths(today, 1))}`, 'events-next-month')} />} />
        <Tile label="Listing a school" note="Listing isn't engagement: only a logged activity counts"
          value={<Figure value={e.upcomingWithSchoolsIds.length} onOpen={open} list={() => lists.events(e.upcomingWithSchoolsIds, 'Upcoming events that list a school', `From ${formatDay(today)}`, 'upcoming-events-with-schools')} />} />
      </Tiles>
      {months.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-neutral-500">Upcoming events by month (the busiest in blue)</p>
          <Columns
            ariaLabel="Upcoming events by month"
            rows={months.map((k, i) => ({ month: formatMonth(k).replace(/ \d{4}$/, (y) => (k.endsWith('-01') || i === 0 ? ` '${y.slice(3)}` : '')), events: counts[i] }))}
            xKey="month"
            series={[{ key: 'events', label: 'Events', color: REPORT_SERIES[0] }]}
            colorFor={(i) => (months[i] === busiest ? REPORT_SERIES[0] : REPORT_QUIET)}
            onPick={(i) => open(lists.events(e.upcomingIds.filter((id) => m.data.events.find((x) => x.id === id)?.date.slice(0, 7) === months[i]), `Events in ${formatMonth(months[i])}`, 'Upcoming outreach events', `events-${months[i]}`))}
          />
        </div>
      )}
    </ReportSection>
  );
}

// ── 3. Data health ──────────────────────────────────────────────────────────────

export function HealthSection({ m }: { m: ReportModel }) {
  const { health: h, lists, open, coverage } = m;
  const total = coverage.contactIds.length;
  const recent = h.verifiedRecentIds.length, older = h.verifiedOlderIds.length, never = h.neverVerifiedIds.length;
  const checked = h.siteStatus.working.length + h.siteStatus.broken.length + h.siteStatus.not_found.length;
  const schoolsTotal = m.reach.totalSchools;
  const parts = [
    { label: `Verified in the last ${VERIFIED_RECENT_MONTHS} months`, n: recent, color: '#184f95', ids: h.verifiedRecentIds },
    { label: `Verified over ${VERIFIED_RECENT_MONTHS} months ago`, n: older, color: '#3987e5', ids: h.verifiedOlderIds },
    { label: 'Never verified', n: never, color: REPORT_QUIET, ids: h.neverVerifiedIds },
  ];
  return (
    <ReportSection
      label="Data health"
      question="How current is our contact data?"
      takeaway={recent + older === 0
        ? <>None of the <b>{plural(total, 'contact')}</b> has been verified yet{checked ? '' : ', and no school website has been checked'}. Treat emails as unconfirmed until the scraper's first run marks who is still listed on each school's site.</>
        : <><b>{pctText(recent, total)} of contacts</b> were verified in the last {VERIFIED_RECENT_MONTHS} months; <b>{fmt(never)}</b> never have been.</>}
      source={`staff.last_verified_at and last_scraped_at for contacts on listed schools; schools.source_status and county_name. "Recent" means since ${formatDay(h.recentFrom)}.`}
    >
      <div className="space-y-2">
        <div className="flex h-3.5 rounded overflow-hidden gap-0.5 bg-white" role="img" aria-label="Contacts by when they were last verified">
          {parts.filter((p) => p.n > 0).map((p) => <div key={p.label} style={{ width: `${(p.n / Math.max(total, 1)) * 100}%`, backgroundColor: p.color }} />)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
          {parts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />{p.label}{' '}
              <Figure value={p.n} onOpen={open} list={() => lists.contacts(p.ids, p.label, `${fmt(p.n)} of ${fmt(total)} contacts`, slug(p.label))} />
            </span>
          ))}
        </div>
      </div>
      <Tiles>
        <Tile label="Seen by the scraper" of={`of ${fmt(total)}`} note="Contacts found on a school's website in any run"
          value={<Figure value={h.scrapedContactIds.length} onOpen={open} list={() => lists.contacts(h.scrapedContactIds, 'Contacts the scraper has seen', 'Any run', 'contacts-seen-by-scraper')} />} />
        <Tile label="School websites checked" of={`of ${fmt(schoolsTotal)}`}
          note={checked ? `${fmt(h.siteStatus.broken.length)} broken, ${fmt(h.siteStatus.not_found.length)} with no site` : 'Not checked yet'}
          value={<Figure value={checked} onOpen={open} list={() => lists.schools([...h.siteStatus.working, ...h.siteStatus.broken, ...h.siteStatus.not_found], 'School websites checked', 'By the scraper', 'websites-checked')} />} />
        <Tile label="Broken website links"
          value={<Figure value={h.siteStatus.broken.length} onOpen={open} list={() => lists.schools(h.siteStatus.broken, 'Schools whose website link is broken', 'As last checked by the scraper', 'broken-websites')} />} />
        <Tile label="Schools with no county" note={h.noCountyIds.length ? 'Left out of county figures' : 'Every school is in a county'}
          value={<Figure value={h.noCountyIds.length} onOpen={open} list={() => lists.schools(h.noCountyIds, 'Schools with no county', 'Left out of county figures', 'no-county')} />} />
      </Tiles>
    </ReportSection>
  );
}

// ── 4. Reach ────────────────────────────────────────────────────────────────────

function LoggingNote({ m }: { m: ReportModel }) {
  if (m.logging.monthsWithData >= MIN_MONTHS_FOR_TREND) return null;
  return (
    <Note title={m.logging.start
      ? `Outreach logging started ${formatDay(m.logging.start)}: ${plural(m.logging.total, 'activity', 'activities')} so far.`
      : 'No outreach has been logged yet.'}>
      The numbers below are real but small. Month-by-month charts appear once {MIN_MONTHS_FOR_TREND} months have activity, and comparisons once a whole earlier period was logged.
    </Note>
  );
}

export function ReachSection({ m }: { m: ReportModel }) {
  const { reach: r, lists, open, range, region } = m;
  const engaged = r.engagedIds.length;
  const trend = m.monthly.monthsWithData >= MIN_MONTHS_FOR_TREND;
  const rows = m.monthly.months.map((x) => ({ month: formatMonth(x.month).slice(0, 3), schools: x.newSchoolIds.length }));
  return (
    <ReportSection
      label="Reach"
      question="How many schools have we engaged, and is it growing?"
      takeaway={engaged
        ? <>{range.label}: <b>{fmt(engaged)} of {plural(r.totalSchools, 'school')}</b> engaged ({pctText(engaged, r.totalSchools)}){r.firstTimeIds.length ? <>, <b>{fmt(r.firstTimeIds.length)}</b> of them for the first time</> : null}.</>
        : <>{range.label}: <b>no school engaged</b> in {placeName(region)} yet.</>}
      source="activities (not archived) on listed schools, dated in the range. Engaged = at least one activity of any type, imported attendance included; being listed on an event doesn't count."
    >
      <LoggingNote m={m} />
      <Tiles>
        <Tile hero label="Schools engaged" of={`of ${fmt(r.totalSchools)}`} note={compare(engaged, m.reachBefore?.engagedIds.length ?? null, m.comparison)}
          value={<Figure value={engaged} onOpen={open} list={() => lists.schools(r.engagedIds, 'Schools engaged', range.label, `schools-engaged-${slug(range.label)}`)} />} />
        <Tile label="Reached for the first time" note="No activity logged with them before this range"
          value={<Figure value={r.firstTimeIds.length} onOpen={open} list={() => lists.schools(r.firstTimeIds, 'Reached for the first time', range.label, `first-time-${slug(range.label)}`)} />} />
      </Tiles>
      {!region && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">By state</p>
          {Object.entries(r.byState).sort().map(([st, s]) => (
            <Meter key={st} label={STATE_NAMES[st] ?? st} part={s.ids.length} whole={s.total}
              figure={<><Figure value={s.ids.length} onOpen={open} list={() => lists.schools(s.ids, `Schools engaged in ${STATE_NAMES[st] ?? st}`, range.label, `schools-engaged-${st.toLowerCase()}`)} /> of {fmt(s.total)} · {pctText(s.ids.length, s.total)}</>} />
          ))}
        </div>
      )}
      {trend && (
        <div className="space-y-1">
          <p className="text-xs text-neutral-500">Schools reached for the first time, by month</p>
          <Columns ariaLabel="Schools reached for the first time by month" rows={rows} xKey="month"
            series={[{ key: 'schools', label: 'New schools', color: REPORT_SERIES[0] }]}
            colorFor={(i) => (i === rows.length - 1 ? REPORT_SERIES[0] : REPORT_QUIET)}
            onPick={(i) => open(lists.schools(m.monthly.months[i].newSchoolIds, `New schools in ${formatMonth(m.monthly.months[i].month)}`, 'First logged activity that month', `new-schools-${m.monthly.months[i].month}`))} />
        </div>
      )}
    </ReportSection>
  );
}

// ── 5. Activity ─────────────────────────────────────────────────────────────────

const TYPES = ['email', 'call', 'visit', EVENT_ATTENDANCE_TYPE];

export function ActivitySection({ m }: { m: ReportModel }) {
  const { activity: a, lists, open, range } = m;
  const total = a.ids.length;
  const counts = Object.entries(a.byType).map(([t, ids]) => [t, ids.length] as const).sort((x, y) => y[1] - x[1]);
  const mix = counts.length <= 3
    ? counts.map(([t, n]) => activityCount(t, n)).join(', ').replace(/, ([^,]*)$/, ' and $1')
    : `mostly ${activityCount(counts[0][0], counts[0][1])}`;
  const other = Object.keys(a.byType).filter((t) => !TYPES.includes(t));
  const trend = m.monthly.monthsWithData >= MIN_MONTHS_FOR_TREND;
  return (
    <ReportSection
      label="Activity"
      question="What outreach happened, and how many students did events bring?"
      takeaway={total
        ? <>{range.label}: <b>{plural(total, 'activity', 'activities')}</b> ({mix}). {a.students
          ? <>Imported attendance lists count <b>{plural(a.students, 'student')}</b>.</>
          : 'No students recorded yet: counts come from imported attendance lists.'}</>
        : <>{range.label}: no activity logged.</>}
      source="activities (not archived) on listed schools, by activity_type and date. Students = the attendee counts on imported rows only."
    >
      <Tiles>
        {TYPES.map((t) => (
          <Tile key={t} label={activityTypeLabel(t)}
            value={<Figure value={a.byType[t]?.length ?? 0} onOpen={open} list={() => lists.activities(a.byType[t] ?? [], activityTypeLabel(t), range.label, `${slug(activityTypeLabel(t))}-${slug(range.label)}`)} />} />
        ))}
        {other.map((t) => (
          <Tile key={t} label={activityTypeLabel(t)}
            value={<Figure value={a.byType[t].length} onOpen={open} list={() => lists.activities(a.byType[t], activityTypeLabel(t), range.label, slug(t))} />} />
        ))}
        <Tile label="Students at events" note={a.studentRowIds.length ? `From ${plural(a.studentRowIds.length, 'imported row')}` : 'From imported attendance lists only'}
          value={<Figure value={a.students} onOpen={open} list={() => lists.activities(a.studentRowIds, 'Imported attendance with a student count', range.label, `students-${slug(range.label)}`)} />} />
        <Tile label="All activities" note={compare(total, m.activityBefore?.ids.length ?? null, m.comparison)}
          value={<Figure value={total} onOpen={open} list={() => lists.activities(a.ids, 'All activities', range.label, `activities-${slug(range.label)}`)} />} />
      </Tiles>
      {trend ? (
        <Columns ariaLabel="Activities by month and type" xKey="month"
          rows={m.monthly.months.map((x) => ({ month: formatMonth(x.month).slice(0, 3), ...Object.fromEntries(TYPES.map((t) => [t, x.byType[t] ?? 0])) }))}
          series={TYPES.map((t, i) => ({ key: t, label: activityTypeLabel(t), color: REPORT_SERIES[i] }))}
          onPick={(i) => open(lists.activities(m.monthly.months[i].activityIds, `Activities in ${formatMonth(m.monthly.months[i].month)}`, range.label, `activities-${m.monthly.months[i].month}`))} />
      ) : total ? (
        <Note title={`The monthly chart appears once ${MIN_MONTHS_FOR_TREND} months have activity.`}>Every activity in the range is behind the numbers above.</Note>
      ) : null}
    </ReportSection>
  );
}

// ── 6. Coverage gaps ────────────────────────────────────────────────────────────

export function GapsSection({ m }: { m: ReportModel }) {
  const { gaps: g, lists, open, region, range } = m;
  const total = m.reach.totalSchools;
  const counties = g.byCounty.length;
  const asOf = formatDay(range.end);
  return (
    <ReportSection
      label="Coverage gaps"
      question="Where have we never reached, and who went quiet?"
      takeaway={<>
        <b>{fmt(g.neverIds.length)} of {plural(total, 'school')}</b> have no logged contact up to {asOf}, and <b>{fmt(g.untouchedCounties.length)} of {plural(counties, 'county', 'counties')}</b> none at all.{' '}
        {g.quietIds.length ? <><b>{plural(g.quietIds.length, 'school')}</b> went quiet: contacted before, but not in the {QUIET_MONTHS} months to {asOf}.</> : `None has gone quiet: that needs contacts older than ${QUIET_MONTHS} months.`}
      </>}
      source={`schools (not archived) by state and county; contacted = any activity on or before ${asOf}; quiet = last activity before ${formatDay(g.quietBefore)}.`}
    >
      <Tiles>
        <Tile label="Never contacted" of={`of ${fmt(total)}`}
          value={<Figure value={g.neverIds.length} onOpen={open} list={() => lists.schools(g.neverIds, 'Never contacted', `No activity up to ${asOf} · ${placeName(region)}`, 'never-contacted')} />} />
        <Tile label="Counties with no contact" of={`of ${fmt(counties)}`}
          value={<Figure value={g.untouchedCounties.length} onOpen={open} list={() => lists.schools(
            m.data.schools.filter((s) => g.untouchedCounties.includes(`${s.state}|${s.county.trim() || '(no county)'}`)).map((s) => s.id),
            'Schools in counties with no contact', `${fmt(g.untouchedCounties.length)} counties`, 'untouched-counties')} />} />
        <Tile label={`Went quiet (${QUIET_MONTHS}+ months)`}
          value={<Figure value={g.quietIds.length} onOpen={open} list={() => lists.schools(g.quietIds, 'Went quiet', `Last activity before ${formatDay(g.quietBefore)}`, 'went-quiet')} />} />
      </Tiles>
      <div className="space-y-1">
        <p className="text-xs text-neutral-500">Counties, lowest share contacted first (county names as stored)</p>
        <CountyTable
          cols={['Schools', 'Contacted']}
          rows={g.byCounty.map((x) => ({
            key: `${x.state}|${x.county}`, name: `${x.county}, ${x.state}`,
            cells: [fmt(x.schoolIds.length),
              <Figure key="c" value={`${fmt(x.contactedIds.length)} / ${fmt(x.schoolIds.length)}`} onOpen={open}
                list={() => lists.schools(x.contactedIds, `Contacted in ${x.county}, ${x.state}`, `Up to ${asOf}`, `contacted-${slug(x.county)}-${x.state.toLowerCase()}`)} />],
          }))}
        />
      </div>
    </ReportSection>
  );
}

// ── 7. Event impact ─────────────────────────────────────────────────────────────

export function ImpactSection({ m }: { m: ReportModel }) {
  const { impact, events: e, lists, open, range, today } = m;
  const names = new Map(m.data.events.map((x) => [x.id, x.name]));
  const best = impact[0];
  const closed = impact.filter((x) => !x.windowOpen);
  const closedSchools = closed.reduce((n, x) => n + x.schoolIds.length, 0), closedFollowed = closed.reduce((n, x) => n + x.followedIds.length, 0);
  return (
    <ReportSection
      label="Event impact"
      question="Which events drew the most schools, and did we follow up?"
      takeaway={best
        ? <><b>{names.get(best.eventId)}</b> drew the most schools ({fmt(best.schoolIds.length)}{best.students ? `, ${plural(best.students, 'student')}` : ''}).{' '}
          {closedSchools ? <><b>{fmt(closedFollowed)} of {plural(closedSchools, 'school')}</b> got a follow-up within {FOLLOW_UP_DAYS} days.</> : `Follow-up rates are final ${FOLLOW_UP_DAYS} days after each event.`}</>
        : <>{range.label} has <b>{plural(e.pastIds.length, 'past outreach event')}</b>, but none has imported attendance yet, so there is nothing to rank.</>}
      source={`events (testing dates left out) dated in the range and before today. Ranked only with imported attendance (Import data → Import activities, with the event chosen). Follow-up = a call, email or visit within ${FOLLOW_UP_DAYS} days after, not part of the same event.`}
    >
      <Tiles>
        <Tile label="Past outreach events" note={range.label}
          value={<Figure value={e.pastIds.length} onOpen={open} list={() => lists.events(e.pastIds, 'Past outreach events', range.label, `past-events-${slug(range.label)}`)} />} />
        <Tile label="Upcoming outreach events" note={`From ${formatDay(today)}`}
          value={<Figure value={e.upcomingIds.length} onOpen={open} list={() => lists.events(e.upcomingIds, 'Upcoming outreach events', `From ${formatDay(today)}`, 'upcoming-events')} />} />
        <Tile label="With imported attendance"
          value={<Figure value={impact.length} onOpen={open} list={() => lists.events(impact.map((x) => x.eventId), 'Events with imported attendance', range.label, 'events-with-attendance')} />} />
      </Tiles>
      {impact.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                <th className="text-left font-medium px-2 py-1.5">Event</th><th className="text-left font-medium px-2 py-1.5">Date</th>
                <th className="text-right font-medium px-2 py-1.5">Schools</th><th className="text-right font-medium px-2 py-1.5">Students</th>
                <th className="text-right font-medium px-2 py-1.5">Followed up in {FOLLOW_UP_DAYS} days</th>
              </tr>
            </thead>
            <tbody>
              {impact.map((x) => (
                <tr key={x.eventId} className="border-b border-neutral-50 last:border-0">
                  <td className="px-2 py-1.5">{names.get(x.eventId)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDay(x.day)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure value={x.schoolIds.length} onOpen={open} list={() => lists.schools(x.schoolIds, `${names.get(x.eventId)}: schools`, formatDay(x.day), `event-${slug(names.get(x.eventId) ?? x.eventId)}-schools`)} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{x.students ? fmt(x.students) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <Figure value={`${fmt(x.followedIds.length)} of ${fmt(x.schoolIds.length)}`} onOpen={open}
                      list={() => lists.schools(x.schoolIds.filter((id) => !x.followedIds.includes(id)), `${names.get(x.eventId)}: not followed up yet`, `No call, email or visit within ${FOLLOW_UP_DAYS} days`, `event-${slug(names.get(x.eventId) ?? x.eventId)}-not-followed`)} />
                    {x.windowOpen && <span className="ml-2 text-xs text-neutral-500">window open</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Note title="Results appear once attendance is imported.">
          Import an attendance list with its event chosen (Import data → Import activities). The event then shows its schools and students here, and whether each school got a call, email or visit within {FOLLOW_UP_DAYS} days.
        </Note>
      )}
    </ReportSection>
  );
}
