import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { useAppContext } from '../context/useAppContext';
import { useRegionScope } from '../context/RegionScopeContext';
import { useRole } from '../context/useRole';
import { useStateFilter } from '../hooks/useStateFilter';
import { useUrlState, useUrlStateBatch } from '../hooks/useUrlState';
import { MIN_MONTHS_FOR_TREND } from '../constants/reportSettings';
import {
  activitySummary, comparisonFor, contactCoverage, dataHealth, eventImpact, eventSummary, formatDay, formatRange,
  gaps, loggingStatus, monthly, reach, resolveRange, type RangePreset,
} from '../utils/reports';
import { fmt, listBuilders, type ListSpec } from '../utils/reportLists';
import { classNames } from '../utils/helpers';
import { ListModal } from '../components/reports/ReportParts';
import {
  ActivitySection, CoverageSection, GapsSection, GettingStarted, HealthSection, ImpactSection, ReachSection,
  UpcomingSection, type ReportModel,
} from '../components/reports/ReportSections';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'semester', label: 'This semester' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function ReportsPage() {
  const { state } = useAppContext();
  const full = useRegionScope()?.fullState ?? state;
  const { isAdmin } = useRole();
  const [region] = useStateFilter();
  const [presetParam, setPreset] = useUrlState('range', 'semester');
  const [from] = useUrlState('from');
  const [to] = useUrlState('to');
  const setMany = useUrlStateBatch();
  const [list, setList] = useState<ListSpec | null>(null);

  const today = format(new Date(), 'yyyy-MM-dd');
  const preset: RangePreset = PRESETS.some((p) => p.value === presetParam) ? (presetParam as RangePreset) : 'semester';
  const custom = DAY.test(from) && DAY.test(to) ? { start: from, end: to } : undefined;

  const model: Omit<ReportModel, 'open'> = useMemo(() => {
    const data = { schools: state.schools, contacts: state.contacts, events: state.events, activities: state.activities };
    const range = resolveRange(preset, today, DAY.test(from) && DAY.test(to) ? { start: from, end: to } : undefined);
    // Logging is the same for every state: it says when the team started logging at all.
    const started = loggingStatus(full.activities);
    const logging = {
      ...started,
      monthsWithData: started.start ? monthly(full.activities, full.schools, { start: started.start, end: today }).monthsWithData : 0,
    };
    const comparison = comparisonFor(range, started.start);
    return {
      data, region, range, today, comparison, logging,
      reach: reach(data.schools, data.activities, range),
      reachBefore: comparison.range ? reach(data.schools, data.activities, comparison.range) : null,
      activity: activitySummary(data.activities, data.schools, range),
      activityBefore: comparison.range ? activitySummary(data.activities, data.schools, comparison.range) : null,
      monthly: monthly(data.activities, data.schools, range),
      coverage: contactCoverage(data.schools, data.contacts),
      events: eventSummary(data.events, range, today),
      impact: eventImpact(data.events, data.activities, data.schools, range, today),
      gaps: gaps(data.schools, data.activities, range.end),
      health: dataHealth(data.schools, data.contacts, range.end),
      lists: listBuilders(data, range.end),
    };
  }, [state, full, region, preset, today, from, to]);

  const m: ReportModel = { ...model, open: setList };
  const { range, comparison, logging } = model;

  // The newest record the scraper added (created, not updated: a person's edit also
  // updates a record), as the date of the last data refresh.
  const lastRefresh = [
    ...full.contacts.filter((c) => c.dataSource !== 'manual').map((c) => c.createdAt),
    ...full.events.filter((e) => e.source && e.source !== 'manual').map((e) => e.createdAt),
  ].reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);
  const lastRefreshDay = lastRefresh ? format(new Date(lastRefresh), 'yyyy-MM-dd') : null;

  const steps = [
    {
      title: 'Log contacts as they happen',
      status: logging.start ? `${fmt(logging.total)} logged so far, since ${formatDay(logging.start)}.` : 'Nothing logged yet.',
      link: { to: '/schools', label: 'Open a school to log a contact' },
      done: logging.monthsWithData >= MIN_MONTHS_FOR_TREND,
    },
    {
      title: 'Import past attendance lists',
      status: full.activities.some((a) => a.importBatchId)
        ? `${fmt(full.activities.filter((a) => a.importBatchId).length)} imported rows so far.`
        : 'None imported yet. Lists from past events, like Book10, go in once their event and date are known.',
      link: { to: '/import', label: 'Import data' },
      done: full.activities.some((a) => a.importBatchId),
    },
    {
      title: 'Freshness tracking',
      status: lastRefreshDay
        ? `The scraper has run by hand: the newest school-website data is from ${formatDay(lastRefreshDay)}.`
        : 'No school-website data has been loaded yet.',
      note: "Tracking when each contact was last seen on its school's site starts with the next run of the updated scraper.",
      done: full.contacts.some((c) => c.lastScrapedAt) || full.schools.some((s) => s.lastScrapedAt || s.sourceStatus),
    },
  ];

  const choose = (value: RangePreset) => {
    if (value === 'custom') setMany({ range: 'custom', from: from || range.start, to: to || range.end });
    else setPreset(value);
  };

  return (
    <div>
      <Header title="Reports" subtitle="Who we can reach, what's coming up, and how outreach is going" />
      <div className="p-4 sm:p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-neutral-200 bg-white overflow-hidden" role="group" aria-label="Date range">
              {PRESETS.map((p, i) => (
                <button key={p.value} type="button" onClick={() => choose(p.value)} aria-pressed={preset === p.value}
                  className={classNames('px-3 py-1.5 text-sm', i > 0 && 'border-l border-neutral-200',
                    preset === p.value ? 'bg-siue-red/10 text-siue-maroon font-semibold' : 'text-neutral-600 hover:bg-neutral-50')}>
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="report-from" className="text-neutral-500">From</label>
                <input id="report-from" type="date" value={custom?.start ?? range.start} max={custom?.end}
                  onChange={(e) => setMany({ from: e.target.value })}
                  className="rounded-lg border border-neutral-200 px-2 py-1" />
                <label htmlFor="report-to" className="text-neutral-500">to</label>
                <input id="report-to" type="date" value={custom?.end ?? range.end} min={custom?.start}
                  onChange={(e) => setMany({ to: e.target.value })}
                  className="rounded-lg border border-neutral-200 px-2 py-1" />
              </div>
            )}
          </div>
          <p className="text-sm text-neutral-600">
            <span className="font-medium text-neutral-800">{range.label}</span>: {formatRange(range)}
            {' · '}{region === 'IL' ? 'Illinois only' : region === 'MO' ? 'Missouri only' : 'Illinois and Missouri'}
            {' · '}{comparison.kind === 'none' ? comparison.label : `compared with ${comparison.label}`}
          </p>
        </div>

        {isAdmin && <GettingStarted steps={steps} />}

        <CoverageSection m={m} />
        <UpcomingSection m={m} />
        <HealthSection m={m} />
        <ReachSection m={m} />
        <ActivitySection m={m} />
        <GapsSection m={m} />
        <ImpactSection m={m} />
      </div>
      <ListModal list={list} onClose={() => setList(null)} />
    </div>
  );
}
