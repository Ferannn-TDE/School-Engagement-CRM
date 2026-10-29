import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, subMonths, isAfter, differenceInDays } from 'date-fns';
import {
  AlertTriangle, School, Clock, ChevronDown, ChevronUp,
  ChevronsUpDown, MapPin, CheckCircle2, CalendarX, Plus,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { LogContactForm } from '../components/activities/LogContactForm';
import { useEngagementMaps, useSchoolsNeedingAttention } from '../hooks/useEngagementMaps';
import { countyGroupName, countyKey, countyLabel, countyPath } from '../utils/counties';
import { useUrlState, useUrlStateBatch } from '../hooks/useUrlState';
import { outreachEvents } from '../utils/events';
import { useRole } from '../context/useRole';
import { Pagination } from '../components/common/Pagination';
import { RowAction, RowActions } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';

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

function WorkSection({
  icon,
  title,
  description,
  count,
  countTone,
  open,
  onToggle,
  emptyTitle,
  emptyBody,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
  countTone: 'attention' | 'neutral';
  /** Controlled by the page so which sections are open can live in the address. */
  open: boolean;
  onToggle: () => void;
  emptyTitle: string;
  emptyBody?: string;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;

  return (
    <Card padding={false} className={open ? 'md:col-span-2' : undefined}>
      <button
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-neutral-50 rounded-xl transition-colors"
        onClick={onToggle}
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

/** A worklist as a table with fixed column widths, one page at a time. Log is the
 *  last column on every row, and only for people who can edit. */
function WorkTable({
  items,
  onLog,
  page,
  onPageChange,
}: {
  items: WorkItem[];
  onLog?: (item: WorkItem) => void;
  /** Controlled by the page so each list's page number lives in the address. */
  page: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * ROWS_PER_PAGE;
  const slice = items.slice(start, start + ROWS_PER_PAGE);
  const th = 'px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-500';

  return (
    <div className="pb-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: '10rem' }} />
            <col style={{ width: '7rem' }} />
            <col style={{ width: '8.5rem' }} />
            <col />
            {onLog && <col style={{ width: '7rem' }} />}
          </colgroup>
          <thead className="bg-neutral-50 border-b border-neutral-100">
            <tr>
              <th className={`${th} text-left pl-6`}>School</th>
              <th className={`${th} text-left`}>County</th>
              <th className={`${th} text-right`}>Contacts</th>
              <th className={`${th} text-left`}>Last contact</th>
              <th className={`${th} text-left`}>Why it&rsquo;s here</th>
              {onLog && <th className={`${th} text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {slice.map((item) => (
              <tr key={item.id} className="hover:bg-neutral-50 transition-colors">
                <td className="relative pl-6 pr-4 py-3">
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${urgencyBar[item.urgency]}`} aria-hidden="true" />
                  <Link
                    to={`/schools/${encodeURIComponent(item.id)}`}
                    className="block break-words font-medium text-neutral-800 hover:text-siue-red transition-colors"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="px-4 py-3 break-words text-neutral-600">{item.county || <Missing label="No county" />}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-700">{item.contactCount}</td>
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600">{item.lastContact}</td>
                <td className="px-4 py-3 text-neutral-600 break-words">{item.reason}</td>
                {onLog && (
                  <td className="px-4 py-3">
                    <RowActions>
                      <RowAction icon={<Plus size={13} />} label="Log" tone="primary" title={`Log contact with ${item.name}`} onClick={() => onLog(item)} />
                    </RowActions>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pageIndex={current - 1} pageSize={ROWS_PER_PAGE} total={items.length} onPageChange={(i) => onPageChange(i + 1)} noun="schools" />
    </div>
  );
}

export function PrioritiesPage() {
  const { canEdit } = useRole();
  const { state, schoolContactsMap, schoolActivitiesMap } = useEngagementMaps();
  // Testing dates are busy dates, not outreach: never counted (db/007).
  const countedEvents = useMemo(() => outreachEvents(state.events), [state.events]);
  const schoolsNeedingAttention = useSchoolsNeedingAttention();
  // Kept in the address so the view survives leaving the tab, a refresh and Back:
  // which sections are open, the sort, and each list's page number.
  const [sortRaw] = useUrlState('sort', 'name');
  const attentionSort: 'name' | 'county' = sortRaw === 'county' ? 'county' : 'name';
  const [openRaw, setOpenRaw] = useUrlState('open');
  const openSections = new Set(openRaw.split(',').filter(Boolean));
  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenRaw([...next].join(','));
  };
  const [followPage, setFollowPage] = useUrlState('p_follow', '1');
  const [attentionPage, setAttentionPage] = useUrlState('p_missing', '1');
  const [noEventPage, setNoEventPage] = useUrlState('p_noevent', '1');
  const setBatch = useUrlStateBatch();
  const pageNum = (v: string) => Math.max(1, Number(v) || 1);
  const [logFor, setLogFor] = useState<WorkItem | null>(null);

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
    for (const event of countedEvents) {
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
  }, [state.schools, countedEvents, schoolContactsMap, schoolActivitiesMap, toItem]);

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
    const inEvents = new Set(countedEvents.flatMap((e) => e.participatingSchools));
    return state.schools
      .filter((s) => !inEvents.has(s.id))
      .sort((a, b) => a.county.localeCompare(b.county) || a.name.localeCompare(b.name))
      .map((s) =>
        toItem(s, s.schoolType === 'high_school' ? 'High school' : 'Middle school', 'cold')
      );
  }, [state.schools, countedEvents, toItem]);

  // ── Counties with the most schools still out of contact ──────────────────────
  const countiesAtRisk = useMemo(() => {
    const countyMap = new Map<string, { county: string; state: string; total: number; withContacts: number }>();
    for (const s of state.schools) {
      if (!s.county || !s.county.trim()) continue;
      const key = countyKey(s.county, s.state);
      const entry = countyMap.get(key) ?? { county: countyGroupName(s.county), state: s.state, total: 0, withContacts: 0 };
      entry.total++;
      if ((schoolContactsMap.get(s.id)?.total ?? 0) > 0) entry.withContacts++;
      countyMap.set(key, entry);
    }
    return Array.from(countyMap.values())
      .map(({ county, state: st, total, withContacts }) => ({
        county,
        state: st,
        total,
        withContacts,
        gap: total - withContacts,
        rate: total > 0 ? withContacts / total : 0,
      }))
      .filter((c) => c.total >= 2 && c.gap > 0)
      .sort((a, b) => b.gap - a.gap);
  }, [state.schools, schoolContactsMap]);

  // Distinct schools, not a sum: a school can appear on both lists. Only the two
  // lists that logging a contact can clear count here. "Never been to an event"
  // is reported on its own, because a call or visit never removes a school from
  // it, and folding it in kept this number stuck at every school.
  const schoolsOutstanding = useMemo(() => {
    const ids = new Set<string>();
    for (const s of upcomingFollowups) ids.add(s.id);
    for (const s of attentionItems) ids.add(s.id);
    return ids.size;
  }, [upcomingFollowups, attentionItems]);

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
              need a follow-up or are missing contacts. A school can appear on both lists.
            </>
          )}
        </p>
        {noEventItems.length > 0 && (
          <p className="text-sm text-neutral-500 max-w-2xl -mt-3">
            Separately, {noEventItems.length.toLocaleString()} schools have never been to an event.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <WorkSection
            icon={<Clock size={18} />}
            title="Follow up"
            open={openSections.has('follow')}
            onToggle={() => toggleSection('follow')}
            description="Came to an event with no follow-up, or has gone quiet since the last contact."
            count={upcomingFollowups.length}
            countTone="attention"
            emptyTitle="No follow-ups waiting"
            emptyBody="Every school with contacts has been in touch recently."
          >
            <WorkTable
              items={upcomingFollowups}
              onLog={canEdit ? setLogFor : undefined}
              page={pageNum(followPage)}
              onPageChange={(n) => setFollowPage(String(n))}
            />
          </WorkSection>

          <WorkSection
            icon={<AlertTriangle size={18} />}
            title="Missing contacts or activity"
            open={openSections.has('missing')}
            onToggle={() => toggleSection('missing')}
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
                // Re-sorting reorders the list, so start it again from page 1.
                onClick={() => setBatch({ sort: attentionSort === 'county' ? '' : 'county', p_missing: '' })}
              >
                {attentionSort === 'county' ? 'County' : 'School name'}
                <ChevronsUpDown size={12} className="text-neutral-400" />
              </button>
            </div>
            <WorkTable
              items={attentionItems}
              onLog={canEdit ? setLogFor : undefined}
              page={pageNum(attentionPage)}
              onPageChange={(n) => setAttentionPage(String(n))}
            />
          </WorkSection>

          <WorkSection
            icon={<CalendarX size={18} />}
            title="Never been to an event"
            open={openSections.has('noevent')}
            onToggle={() => toggleSection('noevent')}
            description="Your coldest leads — these schools have never appeared at an event."
            count={noEventItems.length}
            countTone="neutral"
            emptyTitle="Every school has been to an event"
          >
            <WorkTable
              items={noEventItems}
              onLog={canEdit ? setLogFor : undefined}
              page={pageNum(noEventPage)}
              onPageChange={(n) => setNoEventPage(String(n))}
            />
          </WorkSection>

          <WorkSection
            icon={<MapPin size={18} />}
            title="Counties with the widest gaps"
            open={openSections.has('counties')}
            onToggle={() => toggleSection('counties')}
            description="Where the most schools are still out of contact."
            count={countiesAtRisk.length}
            countTone="neutral"
            emptyTitle="Every county has good contact coverage"
          >
            <div className="divide-y divide-neutral-50">
              {countiesAtRisk.slice(0, 12).map((c) => (
                <div key={countyKey(c.county, c.state)} className="relative">
                  <span
                    className={`absolute left-0 top-0 bottom-0 w-1 ${
                      c.rate < 0.34 ? urgencyBar.overdue : urgencyBar.due
                    }`}
                    aria-hidden="true"
                  />
                  <div className="px-6 py-3">
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <Link
                        to={countyPath(c.county, c.state)}
                        className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate"
                      >
                        {countyLabel(c.county, c.state)}
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

      <Modal
        open={logFor !== null}
        onClose={() => setLogFor(null)}
        title={logFor ? `Log contact — ${logFor.name}` : 'Log contact'}
        size="md"
      >
        {logFor && <LogContactForm schoolId={logFor.id} onClose={() => setLogFor(null)} />}
      </Modal>
    </div>
  );
}
