import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Printer } from 'lucide-react';
import { useAppContext } from '../context/useAppContext';
import { useStateFilter } from '../hooks/useStateFilter';
import { useUrlState } from '../hooks/useUrlState';
import { Button } from '../components/common/Button';
import { formatDay, resolveRange, type RangePreset } from '../utils/reports';
import { activityTypeLabel, fmt } from '../utils/reportLists';
import { meetingSummary } from '../utils/meetingSummary';
import { RECENT_CONTACT_DAYS, FOLLOW_UP_DAYS, QUIET_MONTHS } from '../constants/reportSettings';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const placeName = (region: string) => (region === 'IL' ? 'Illinois' : region === 'MO' ? 'Missouri' : 'Illinois and Missouri');
const PRESETS = ['month', 'semester', 'year', 'custom'];

/**
 * One term on one or two printed pages, for meetings: the headline numbers, events and
 * visitors, event follow-ups, coverage gaps and the Priorities counts. Same term and
 * state as the Reports page (the same address settings), and the same calculations.
 */
export function MeetingSummaryPage() {
  const { state } = useAppContext();
  const [region] = useStateFilter();
  const [presetParam] = useUrlState('range', 'semester');
  const [from] = useUrlState('from');
  const [to] = useUrlState('to');
  const today = format(new Date(), 'yyyy-MM-dd');
  const preset = (PRESETS.includes(presetParam) ? presetParam : 'semester') as RangePreset;
  const range = useMemo(
    () => resolveRange(preset, today, DAY.test(from) && DAY.test(to) ? { start: from, end: to } : undefined),
    [preset, today, from, to]
  );

  const s = useMemo(
    () => meetingSummary({ schools: state.schools, contacts: state.contacts, events: state.events, activities: state.activities }, range, today),
    [state, range, today]
  );
  const names = useMemo(() => new Map(state.events.map((e) => [e.id, e.name])), [state.events]);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  const back = `/reports${window.location.search}`;

  return (
    <div className="p-8 print:p-0 max-w-5xl mx-auto meeting-summary">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 print:hidden">
        <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-siue-red">
          <ArrowLeft size={14} /> Back to Reports
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer size={14} /> Print or save as PDF
        </Button>
      </div>

      <header className="mb-5 border-b border-neutral-200 pb-3">
        <h1 className="text-2xl font-bold text-neutral-900">Outreach meeting summary</h1>
        <p className="text-sm text-neutral-600 mt-1">
          {range.label}: {formatDay(range.start)} – {formatDay(range.end)} · {placeName(region)} · prepared {formatDay(today)}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5 print:grid-cols-5">
        <Stat label="Schools reached" value={fmt(s.headline.reached)} note={`of ${fmt(s.headline.schools)} (${pct(s.headline.reached, s.headline.schools)})`} />
        <Stat label="First-time schools" value={fmt(s.headline.firstTime)} />
        <Stat label="Activities" value={fmt(s.headline.activities)} note={s.mix.slice(0, 3).map((m) => `${fmt(m.count)} ${activityTypeLabel(m.type).toLowerCase()}`).join(', ') || 'none yet'} />
        <Stat label="Visitors" value={fmt(s.headline.visitors)} note="logged visits and imports" />
        <Stat label="Events held" value={fmt(s.events.past)} note={`${fmt(s.events.upcoming)} coming up`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 print:grid-cols-2">
        <Section title="Events and follow-ups">
          <p className="text-sm text-neutral-700 mb-2">
            {fmt(s.events.withAttendance)} event{s.events.withAttendance === 1 ? '' : 's'} with imported attendance brought {fmt(s.events.visitorsAtEvents)} visitors.{' '}
            {s.followUps.schools
              ? <>{fmt(s.followUps.followed)} of {fmt(s.followUps.schools)} attending schools ({pct(s.followUps.followed, s.followUps.schools)}) got a call, email or visit within {FOLLOW_UP_DAYS} days.</>
              : 'No attendance imported for this term yet.'}
          </p>
          {s.followUps.byEvent.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-neutral-500 border-b border-neutral-200">
                <th className="text-left font-medium py-1">Event</th><th className="text-left font-medium py-1">Date</th>
                <th className="text-right font-medium py-1">Schools</th><th className="text-right font-medium py-1">Followed up</th>
              </tr></thead>
              <tbody>
                {s.followUps.byEvent.slice(0, 8).map((x) => (
                  <tr key={x.eventId} className="border-b border-neutral-100 last:border-0">
                    <td className="py-1 pr-2">{names.get(x.eventId) ?? 'Event'}</td>
                    <td className="py-1 whitespace-nowrap">{formatDay(x.day)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(x.schools)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(x.followed)}{x.windowOpen ? ' (open)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Coverage gaps">
          <ul className="text-sm text-neutral-700 space-y-1 mb-2">
            <li><b>{fmt(s.gaps.neverContacted)}</b> schools never contacted (up to {formatDay(range.end)})</li>
            <li><b>{fmt(s.gaps.quiet)}</b> gone quiet (nothing in {QUIET_MONTHS} months)</li>
            <li><b>{fmt(s.gaps.untouchedCounties)}</b> counties where no school has been contacted</li>
          </ul>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-neutral-500 border-b border-neutral-200">
              <th className="text-left font-medium py-1">Least-reached counties</th>
              <th className="text-right font-medium py-1">Contacted</th>
            </tr></thead>
            <tbody>
              {s.gaps.lowestCounties.map((c) => (
                <tr key={`${c.state}|${c.county}`} className="border-b border-neutral-100 last:border-0">
                  <td className="py-1">{c.county}, {c.state}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(c.contacted)} of {fmt(c.schools)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Priorities today">
          <ul className="text-sm text-neutral-700 space-y-1">
            <li><b>{fmt(s.priorities.recentlyInTouch)}</b> schools recently in touch (last {RECENT_CONTACT_DAYS} days): keep the connection going</li>
            <li><b>{fmt(s.priorities.neverReached)}</b> have contacts but were never reached</li>
            <li><b>{fmt(s.priorities.noContactPerson)}</b> have no contact person on file</li>
          </ul>
          <p className="text-xs text-neutral-500 mt-2">As of today, whatever the term: Priorities is a to-do list, not a history.</p>
        </Section>

        <Section title="Activity by type">
          {s.mix.length ? (
            <ul className="text-sm text-neutral-700 space-y-1">
              {s.mix.map((m) => <li key={m.type}><b>{fmt(m.count)}</b> {activityTypeLabel(m.type).toLowerCase()}</li>)}
            </ul>
          ) : <p className="text-sm text-neutral-500">No activity logged in this term.</p>}
        </Section>
      </div>

      <p className="text-xs text-neutral-500 mt-5">
        Same figures as the Reports page for this term and state. Upcoming (future-dated) activities don't count until their day.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 break-inside-avoid">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-2xl font-bold text-neutral-900 tabular-nums">{value}</p>
      {note && <p className="text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 break-inside-avoid">
      <h2 className="text-sm font-semibold text-neutral-800 mb-2">{title}</h2>
      {children}
    </section>
  );
}
