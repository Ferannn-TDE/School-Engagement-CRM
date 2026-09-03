import { useMemo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { subMonths, isAfter, differenceInDays } from 'date-fns';
import {
  AlertTriangle, School, Clock, ChevronDown, ChevronUp,
  ChevronsUpDown, MapPin, CheckCircle2, CalendarX,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { useEngagementMaps, useSchoolsNeedingAttention } from '../hooks/useEngagementMaps';
import {
  fetchSchoolEngagementSummary,
  type SchoolEngagementSummaryRow,
} from '../services/analyticsService';

/** How overdue something is, used to colour the left edge of a row.
 *  Deliberately distinct from SIUE red, which means "brand", not "urgent". */
type Urgency = 'overdue' | 'due' | 'cold';

const urgencyBar: Record<Urgency, string> = {
  overdue: 'bg-attention-high',
  due: 'bg-attention-medium',
  cold: 'bg-attention-low',
};

/** A section of the worklist. Each one answers "who needs me, and why". */
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
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = count === 0;

  return (
    <Card padding={false}>
      <button
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-neutral-50 rounded-xl transition-colors"
        onClick={() => setOpen((v) => !v)}
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
            {count}
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

/** One actionable row: a coloured urgency edge, the school, and why it's listed. */
function WorkRow({
  to,
  name,
  meta,
  reason,
  urgency,
}: {
  to: string;
  name: string;
  meta: string;
  reason: React.ReactNode;
  urgency: Urgency;
}) {
  return (
    <div className="flex items-stretch gap-3 hover:bg-neutral-50 transition-colors">
      <span className={`w-1 shrink-0 ${urgencyBar[urgency]}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 flex items-center justify-between gap-4 py-3 pr-6">
        <div className="min-w-0">
          <Link
            to={to}
            className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors block truncate"
          >
            {name}
          </Link>
          <p className="text-xs text-neutral-500 mt-0.5">{meta}</p>
        </div>
        <div className="shrink-0 text-right">{reason}</div>
      </div>
    </div>
  );
}

export function PrioritiesPage() {
  const { state, schoolContactsMap, schoolActivitiesMap } = useEngagementMaps();

  const [schoolSummary, setSchoolSummary] = useState<SchoolEngagementSummaryRow[]>([]);
  useEffect(() => {
    fetchSchoolEngagementSummary().then(setSchoolSummary).catch(() => {});
  }, []);

  const [attentionSort, setAttentionSort] = useState<'name' | 'county'>('name');

  // ── Schools that attended something recently, or have gone quiet ─────────────
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

    const result: Array<{
      id: string;
      name: string;
      county: string;
      reason: string;
      urgency: number;
      tone: Urgency;
    }> = [];
    const seen = new Set<string>();

    for (const s of state.schools) {
      if (seen.has(s.id)) continue;
      if (recentEventSchoolIds.has(s.id) && !schoolActivitiesMap.get(s.id)) {
        result.push({
          id: s.id,
          name: s.name,
          county: s.county,
          reason: 'Came to a recent event, never followed up',
          urgency: 9999,
          tone: 'overdue',
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
          id: s.id,
          name: s.name,
          county: s.county,
          reason: 'Has contacts, nothing logged yet',
          urgency: 8888,
          tone: 'due',
        });
        seen.add(s.id);
      } else if (acts.latestDate && !isAfter(acts.latestDate, thirtyDaysAgo)) {
        const days = differenceInDays(now, acts.latestDate);
        result.push({
          id: s.id,
          name: s.name,
          county: s.county,
          reason: `${days} days since last contact`,
          urgency: days,
          tone: days >= 90 ? 'overdue' : 'due',
        });
        seen.add(s.id);
      }
    }

    return result.sort((a, b) => b.urgency - a.urgency).slice(0, 25);
  }, [state.schools, state.events, schoolContactsMap, schoolActivitiesMap]);

  const schoolsNeedingAttention = useSchoolsNeedingAttention();

  const sortedAttention = useMemo(
    () =>
      [...schoolsNeedingAttention].sort((a, b) =>
        attentionSort === 'county'
          ? a.county.localeCompare(b.county) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name)
      ),
    [schoolsNeedingAttention, attentionSort]
  );

  // ── Schools that have never appeared at an event ─────────────────────────────
  const schoolsWithNoEvents = useMemo(() => {
    if (schoolSummary.length > 0) {
      const zeroEventIds = new Set(
        schoolSummary.filter((r) => r.event_count === 0).map((r) => r.facility_key)
      );
      return state.schools
        .filter((s) => zeroEventIds.has(s.id))
        .sort((a, b) => a.county.localeCompare(b.county) || a.name.localeCompare(b.name));
    }
    const schoolIdsInEvents = new Set(state.events.flatMap((e) => e.participatingSchools));
    return state.schools
      .filter((s) => !schoolIdsInEvents.has(s.id))
      .sort((a, b) => a.county.localeCompare(b.county) || a.name.localeCompare(b.name));
  }, [schoolSummary, state.schools, state.events]);

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
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 8);
  }, [state.schools, schoolContactsMap]);

  const totalOutstanding =
    upcomingFollowups.length + schoolsNeedingAttention.length + schoolsWithNoEvents.length;

  return (
    <div>
      <Header
        title="Priorities"
        subtitle="Schools waiting on you, most urgent first"
      />
      <div className="p-8 space-y-6 max-w-5xl">
        <p className="text-lg text-neutral-600 max-w-2xl">
          {totalOutstanding === 0 ? (
            <>Nothing is waiting. Every school has active contacts and recent engagement.</>
          ) : (
            <>
              <span className="font-semibold text-neutral-800">{totalOutstanding} schools</span> need
              attention. Start at the top — each list is ordered by how long it has been waiting.
            </>
          )}
        </p>

        <WorkSection
          icon={<Clock size={18} />}
          title="Follow up"
          description="Came to an event with no follow-up, or has gone quiet since the last contact."
          count={upcomingFollowups.length}
          countTone="attention"
          defaultOpen
          emptyTitle="No follow-ups waiting"
          emptyBody="Every school with contacts has been in touch recently."
        >
          <div className="divide-y divide-neutral-50">
            {upcomingFollowups.map((s) => (
              <WorkRow
                key={s.id}
                to={`/schools/${encodeURIComponent(s.id)}`}
                name={s.name}
                meta={s.county ? `${s.county} County` : 'No county recorded'}
                urgency={s.tone}
                reason={
                  <span className="text-xs text-neutral-600">{s.reason}</span>
                }
              />
            ))}
          </div>
        </WorkSection>

        <WorkSection
          icon={<AlertTriangle size={18} />}
          title="Missing contacts or activity"
          description="No contacts on file, or nothing logged in the last six months."
          count={schoolsNeedingAttention.length}
          countTone="attention"
          emptyTitle="Every school is in good standing"
          emptyBody="All schools have active contacts and recent engagement."
        >
          <div className="flex items-center justify-end gap-2 px-6 py-2.5 bg-neutral-50 border-b border-neutral-100">
            <span className="text-xs text-neutral-500">Sort by</span>
            <button
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-siue-red transition-colors"
              onClick={() => setAttentionSort((s) => (s === 'county' ? 'name' : 'county'))}
            >
              {attentionSort === 'county' ? 'County' : 'School name'}
              <ChevronsUpDown size={12} className="text-neutral-400" />
            </button>
          </div>
          <div className="divide-y divide-neutral-50">
            {sortedAttention.map((s) => (
              <WorkRow
                key={s.id}
                to={`/schools/${encodeURIComponent(s.id)}`}
                name={s.name}
                meta={`${s.county ? `${s.county} County` : 'No county'} · ${s.contactCount} contact${
                  s.contactCount !== 1 ? 's' : ''
                } · last contact ${s.lastActivity}`}
                urgency={s.severity === 'high' ? 'overdue' : 'due'}
                reason={
                  <div className="flex flex-wrap justify-end gap-1 max-w-[260px]">
                    {s.issues.map((issue) => (
                      <Badge key={issue} variant="warning">
                        {issue}
                      </Badge>
                    ))}
                  </div>
                }
              />
            ))}
          </div>
        </WorkSection>

        <WorkSection
          icon={<CalendarX size={18} />}
          title="Never been to an event"
          description="Your coldest leads — these schools have never appeared at an event."
          count={schoolsWithNoEvents.length}
          countTone="neutral"
          emptyTitle="Every school has been to an event"
        >
          <div className="divide-y divide-neutral-50">
            {schoolsWithNoEvents.map((s) => (
              <WorkRow
                key={s.id}
                to={`/schools/${encodeURIComponent(s.id)}`}
                name={s.name}
                meta={`${s.county ? `${s.county} County` : 'No county'} · ${
                  s.schoolType === 'high_school' ? 'High school' : 'Middle school'
                }`}
                urgency="cold"
                reason={
                  <span className="text-xs text-neutral-500">
                    {schoolContactsMap.get(s.id)?.total ?? 0} contact
                    {(schoolContactsMap.get(s.id)?.total ?? 0) !== 1 ? 's' : ''}
                  </span>
                }
              />
            ))}
          </div>
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
            {countiesAtRisk.map((c) => (
              <div key={c.county} className="flex items-stretch gap-3">
                <span
                  className={`w-1 shrink-0 ${c.rate < 0.34 ? urgencyBar.overdue : urgencyBar.due}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0 py-3 pr-6">
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
        </WorkSection>

        <p className="text-xs text-neutral-500 flex items-center gap-1.5 pt-2">
          <School size={13} />
          Charts and totals for the whole program live on the Reports page.
        </p>
      </div>
    </div>
  );
}
