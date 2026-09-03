import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, subMonths, isAfter, differenceInDays } from 'date-fns';
import {
  AlertTriangle, School, Clock, ChevronDown, ChevronUp,
  ChevronsUpDown, MapPin, CheckCircle2, CalendarX,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { useEngagementMaps, useSchoolsNeedingAttention } from '../hooks/useEngagementMaps';

/** How overdue something is, used to colour the left edge of a row.
 *  Deliberately distinct from SIUE red, which means "brand", not "urgent". */
type Urgency = 'overdue' | 'due' | 'cold';

const urgencyBar: Record<Urgency, string> = {
  overdue: 'bg-attention-high',
  due: 'bg-attention-medium',
  cold: 'bg-attention-low',
};

/** One row of a worklist. Every list shares this shape so the columns line up
 *  across sections and the eye can scan straight down a column. */
export interface WorkItem {
  id: string;
  name: string;
  county: string;
  contactCount: number;
  lastContact: string;
  reason: string;
  urgency: Urgency;
}

const ROWS_PER_PAGE = 25;

/** Shared column widths. Kept in one place so the header and the rows cannot
 *  drift apart — a misaligned table is worse than no table. */
const COLS =
  'grid grid-cols-[minmax(0,1.8fr)_minmax(0,0.85fr)_4.5rem_6rem_minmax(0,3.2fr)] gap-4 items-center';

function WorkSection({
  icon,
  title,
  description,
  count,
  countTone,
  defaultOpen = false,
  emptyTitle,
  emptyBody,
  children,
  onOpenChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  countTone: 'attention' | 'neutral';
  defaultOpen?: boolean;
  emptyTitle: string;
  emptyBody?: string;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = count === 0;

  function toggle() {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  }

  return (
    <Card padding={false} className={open ? 'md:col-span-2' : undefined}>
      <button
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-neutral-50 rounded-xl transition-colors"
        onClick={toggle}
        aria-expanded={open}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 shrink-0 text-neutral-400">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
            <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Badge variant={isEmpty ? 'success' : countTone === 'attention' ? 'warning' : 'info'}>
            {count.toLocaleString()}
          </Badge>
          {open ? (
            <ChevronUp size={18} className="text-neutral-400" />
          ) : (
            <ChevronDown size={18} className="text-neutral-400" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-neutral-100">
          {isEmpty ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-3 text-success opacity-60" />
              <p className="text-sm font-medium text-success">{emptyTitle}</p>
              {emptyBody && <p className="text-sm text-neutral-500 mt-1">{emptyBody}</p>}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </Card>
  );
}

/** Numbered pager. Chosen over infinite scroll because a fixed page count is
 *  easier to reason about — you can tell how much work is left, and come back
 *  to where you were. */
function Pager({
  page,
  pageCount,
  total,
  from,
  to,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) {
    return (
      <div className="px-6 py-3 text-xs text-neutral-500 border-t border-neutral-100">
        Showing all {total.toLocaleString()}
      </div>
    );
  }

  // A window around the current page, always including first and last.
  const nums: (number | 'gap')[] = [];
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== 'gap') nums.push('gap');
  }

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 border-t border-neutral-100 flex-wrap">
      <p className="text-xs text-neutral-500">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <button
          className="px-2.5 py-1 text-xs rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
        >
          Previous
        </button>
        {nums.map((n, i) =>
          n === 'gap' ? (
            <span key={`gap-${i}`} className="px-1.5 text-xs text-neutral-400">
              …
            </span>
          ) : (
            <button
              key={n}
              onClick={() => onChange(n)}
              aria-current={n === page ? 'page' : undefined}
              className={
                n === page
                  ? 'px-2.5 py-1 text-xs rounded-md bg-siue-red text-white font-medium'
                  : 'px-2.5 py-1 text-xs rounded-md text-neutral-600 hover:bg-neutral-100'
              }
            >
              {n}
            </button>
          )
        )}
        <button
          className="px-2.5 py-1 text-xs rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={() => onChange(page + 1)}
          disabled={page === pageCount}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** A worklist rendered as aligned columns, one page at a time. */
function WorkTable({ items }: { items: WorkItem[] }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * ROWS_PER_PAGE;
  const slice = items.slice(start, start + ROWS_PER_PAGE);

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[48rem]">
          <div
            className={`${COLS} px-6 py-2.5 bg-neutral-50 border-b border-neutral-100 text-xs font-semibold text-neutral-500 uppercase tracking-wider`}
          >
            <span>School</span>
            <span>County</span>
            <span className="text-right">Contacts</span>
            <span>Last contact</span>
            <span>Why it&rsquo;s here</span>
          </div>

          <div className="divide-y divide-neutral-50">
            {slice.map((item) => (
              <div key={item.id} className="relative hover:bg-neutral-50 transition-colors">
                <span
                  className={`absolute left-0 top-0 bottom-0 w-1 ${urgencyBar[item.urgency]}`}
                  aria-hidden="true"
                />
                <div className={`${COLS} px-6 py-3`}>
                  <Link
                    to={`/schools/${encodeURIComponent(item.id)}`}
                    className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate"
                    title={item.name}
                  >
                    {item.name}
                  </Link>
                  <span className="text-sm text-neutral-500 truncate">
                    {item.county || <span className="text-neutral-400">—</span>}
                  </span>
                  <span className="text-sm text-neutral-600 text-right tabular-nums">
                    {item.contactCount}
                  </span>
                  <span className="text-sm text-neutral-600">{item.lastContact}</span>
                  <span className="text-sm text-neutral-600 truncate" title={item.reason}>
                    {item.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Pager
        page={current}
        pageCount={pageCount}
        total={items.length}
        from={start + 1}
        to={start + slice.length}
        onChange={setPage}
      />
    </div>
  );
}

export function PrioritiesPage() {
  const { state, schoolContactsMap, schoolActivitiesMap } = useEngagementMaps();
  const schoolsNeedingAttention = useSchoolsNeedingAttention();
  const [attentionSort, setAttentionSort] = useState<'name' | 'county'>('name');

  /** Fills in the columns every list shares, so rows align across sections. */
  const toItem = useCallback(
    (
      school: { id: string; name: string; county: string },
      reason: string,
      urgency: Urgency
    ): WorkItem => {
      const acts = schoolActivitiesMap.get(school.id);
      return {
        id: school.id,
        name: school.name,
        county: school.county,
        contactCount: schoolContactsMap.get(school.id)?.total ?? 0,
        lastContact: acts?.latestDate ? format(acts.latestDate, 'd MMM yyyy') : 'Never',
        reason,
        urgency,
      };
    },
    [schoolContactsMap, schoolActivitiesMap]
  );

  // ── Attended something recently, or has gone quiet ───────────────────────────
  const upcomingFollowups = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = subMonths(now, 1);
    const ninetyDaysAgo = subMonths(now, 3);

    const recentEventSchoolIds = new Set<string>();
    for (const event of state.events) {
      if (!event.date) continue;
      try {
        if (isAfter(new Date(event.date.slice(0, 10)), ninetyDaysAgo)) {
          event.participatingSchools.forEach((id) => recentEventSchoolIds.add(id));
        }
      } catch {
        /* skip unparseable dates */
      }
    }

    const result: Array<WorkItem & { sortKey: number }> = [];
    const seen = new Set<string>();

    for (const s of state.schools) {
      if (recentEventSchoolIds.has(s.id) && !schoolActivitiesMap.get(s.id)) {
        result.push({
          ...toItem(s, 'Came to a recent event, never followed up', 'overdue'),
          sortKey: Number.MAX_SAFE_INTEGER,
        });
        seen.add(s.id);
      }
    }

    for (const s of state.schools) {
      if (seen.has(s.id)) continue;
      if ((schoolContactsMap.get(s.id)?.active ?? 0) === 0) continue;
      const acts = schoolActivitiesMap.get(s.id);
      if (!acts) {
        result.push({
          ...toItem(s, 'Has contacts, nothing logged yet', 'due'),
          sortKey: Number.MAX_SAFE_INTEGER - 1,
        });
        seen.add(s.id);
      } else if (acts.latestDate && !isAfter(acts.latestDate, thirtyDaysAgo)) {
        const days = differenceInDays(now, acts.latestDate);
        result.push({
          ...toItem(s, `${days} days since last contact`, days >= 90 ? 'overdue' : 'due'),
          sortKey: days,
        });
        seen.add(s.id);
      }
    }

    return result.sort((a, b) => b.sortKey - a.sortKey);
  }, [state.schools, state.events, schoolContactsMap, schoolActivitiesMap, toItem]);

  // ── No contacts, or nothing logged in six months ─────────────────────────────
  const attentionItems = useMemo(() => {
    const items = schoolsNeedingAttention.map((s) => ({
      ...toItem(s, s.issues.join(' · '), s.severity === 'high' ? 'overdue' : 'due'),
      county: s.county,
    }));
    return items.sort((a, b) =>
      attentionSort === 'county'
        ? a.county.localeCompare(b.county) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name)
    );
  }, [schoolsNeedingAttention, attentionSort, toItem]);

  // ── Never appeared at an event ───────────────────────────────────────────────
  const noEventItems = useMemo(() => {
    const inEvents = new Set(state.events.flatMap((e) => e.participatingSchools));
    return state.schools
      .filter((s) => !inEvents.has(s.id))
      .sort((a, b) => a.county.localeCompare(b.county) || a.name.localeCompare(b.name))
      .map((s) =>
        toItem(s, s.schoolType === 'high_school' ? 'High school' : 'Middle school', 'cold')
      );
  }, [state.schools, state.events, toItem]);

  // ── Counties with the most schools still out of contact ──────────────────────
  const countiesAtRisk = useMemo(() => {
    const countyMap = new Map<string, { total: number; withContacts: number }>();
    for (const s of state.schools) {
      if (!s.county || !s.county.trim()) continue;
      const entry = countyMap.get(s.county) ?? { total: 0, withContacts: 0 };
      entry.total++;
      if ((schoolContactsMap.get(s.id)?.total ?? 0) > 0) entry.withContacts++;
      countyMap.set(s.county, entry);
    }
    return Array.from(countyMap.entries())
      .map(([county, { total, withContacts }]) => ({
        county,
        total,
        withContacts,
        gap: total - withContacts,
        rate: total > 0 ? withContacts / total : 0,
      }))
      .filter((c) => c.total >= 2 && c.gap > 0)
      .sort((a, b) => b.gap - a.gap);
  }, [state.schools, schoolContactsMap]);

  // Distinct schools, not a sum: a school can appear on more than one list, and
  // adding the lists together produced a total larger than the school count.
  const schoolsOutstanding = useMemo(() => {
    const ids = new Set<string>();
    for (const s of upcomingFollowups) ids.add(s.id);
    for (const s of attentionItems) ids.add(s.id);
    for (const s of noEventItems) ids.add(s.id);
    return ids.size;
  }, [upcomingFollowups, attentionItems, noEventItems]);

  return (
    <div>
      <Header title="Priorities" subtitle="Schools waiting on you, most urgent first" />
      <div className="p-8 space-y-6">
        <p className="text-lg text-neutral-600 max-w-2xl">
          {schoolsOutstanding === 0 ? (
            <>Nothing is waiting. Every school has active contacts and recent engagement.</>
          ) : (
            <>
              <span className="font-semibold text-neutral-800">
                {schoolsOutstanding.toLocaleString()} of {state.schools.length.toLocaleString()}{' '}
                schools
              </span>{' '}
              need attention. A school can appear on more than one list below.
            </>
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <WorkSection
            icon={<Clock size={18} />}
            title="Follow up"
            description="Came to an event with no follow-up, or has gone quiet since the last contact."
            count={upcomingFollowups.length}
            countTone="attention"
            emptyTitle="No follow-ups waiting"
            emptyBody="Every school with contacts has been in touch recently."
          >
            <WorkTable items={upcomingFollowups} />
          </WorkSection>

          <WorkSection
            icon={<AlertTriangle size={18} />}
            title="Missing contacts or activity"
            description="No contacts on file, or nothing logged in the last six months."
            count={attentionItems.length}
            countTone="attention"
            emptyTitle="Every school is in good standing"
            emptyBody="All schools have active contacts and recent engagement."
          >
            <div className="flex items-center justify-end gap-2 px-6 py-2.5 bg-neutral-50 border-b border-neutral-100">
              <span className="text-xs text-neutral-500">Sort by</span>
              <button
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-siue-red transition-colors"
                onClick={() => setAttentionSort((v) => (v === 'county' ? 'name' : 'county'))}
              >
                {attentionSort === 'county' ? 'County' : 'School name'}
                <ChevronsUpDown size={12} className="text-neutral-400" />
              </button>
            </div>
            <WorkTable items={attentionItems} />
          </WorkSection>

          <WorkSection
            icon={<CalendarX size={18} />}
            title="Never been to an event"
            description="Your coldest leads — these schools have never appeared at an event."
            count={noEventItems.length}
            countTone="neutral"
            emptyTitle="Every school has been to an event"
          >
            <WorkTable items={noEventItems} />
          </WorkSection>

          <WorkSection
            icon={<MapPin size={18} />}
            title="Counties with the widest gaps"
            description="Where the most schools are still out of contact."
            count={countiesAtRisk.length}
            countTone="neutral"
            emptyTitle="Every county has good contact coverage"
          >
            <div className="divide-y divide-neutral-50">
              {countiesAtRisk.slice(0, 12).map((c) => (
                <div key={c.county} className="relative">
                  <span
                    className={`absolute left-0 top-0 bottom-0 w-1 ${
                      c.rate < 0.34 ? urgencyBar.overdue : urgencyBar.due
                    }`}
                    aria-hidden="true"
                  />
                  <div className="px-6 py-3">
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <Link
                        to={`/counties/${encodeURIComponent(c.county)}`}
                        className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate"
                      >
                        {c.county} County
                      </Link>
                      <span className="text-xs font-medium text-attention-high-text shrink-0">
                        {c.gap} not yet contacted
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-attention-medium rounded-full"
                          style={{ width: `${Math.round(c.rate * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-neutral-500 shrink-0 w-24 text-right">
                        {c.withContacts} of {c.total} reached
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {countiesAtRisk.length > 12 && (
              <div className="px-6 py-3 text-xs text-neutral-500 border-t border-neutral-100">
                Showing the 12 widest gaps of {countiesAtRisk.length.toLocaleString()} counties.
              </div>
            )}
          </WorkSection>
        </div>

        <p className="text-xs text-neutral-500 flex items-center gap-1.5 pt-2">
          <School size={13} />
          Charts and totals for the whole program live on the Reports page.
        </p>
      </div>
    </div>
  );
}
