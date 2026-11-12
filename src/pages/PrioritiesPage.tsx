import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  School, Clock, ChevronDown, ChevronUp, MapPin, CheckCircle2, Plus, ExternalLink,
  Moon, UserPlus, UserX,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { LogContactForm } from '../components/activities/LogContactForm';
import { useAppContext } from '../context/useAppContext';
import { priorityLists, countyGaps } from '../utils/priorities';
import { dayOf, daysBetween, formatDay, loggingStatus, addMonths } from '../utils/reports';
import { todayDay } from '../utils/activityDates';
import { countyGroupName, countyKey, countyLabel, countyPath } from '../utils/counties';
import { useUrlState } from '../hooks/useUrlState';
import { useRole } from '../context/useRole';
import { Pagination } from '../components/common/Pagination';
import { RowAction, RowActions } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';
import { FOLLOW_UP_DAYS, QUIET_MONTHS } from '../constants/reportSettings';

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
  emptyNeutral,
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
  /** Shown instead of the green "all clear" when an empty list isn't good news yet. */
  emptyNeutral?: boolean;
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
          <Badge variant={isEmpty ? (emptyNeutral ? 'default' : 'success') : countTone === 'attention' ? 'warning' : 'info'}>
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
            <div className="py-10 px-6 text-center">
              {!emptyNeutral && <CheckCircle2 size={28} className="mx-auto mb-3 text-success opacity-60" />}
              <p className={`text-sm font-medium ${emptyNeutral ? 'text-neutral-700' : 'text-success'}`}>{emptyTitle}</p>
              {emptyBody && <p className="text-sm text-neutral-500 mt-1 max-w-xl mx-auto">{emptyBody}</p>}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </Card>
  );
}

/** A worklist as a table with fixed column widths, one page at a time. Actions are
 *  the last column: Log (for people who can edit) and Open school. */
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
  const navigate = useNavigate();
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
            <col style={{ width: onLog ? '9.5rem' : '5.5rem' }} />
          </colgroup>
          <thead className="bg-neutral-50 border-b border-neutral-100">
            <tr>
              <th className={`${th} text-left pl-6`}>School</th>
              <th className={`${th} text-left`}>County</th>
              <th className={`${th} text-right`}>Contacts</th>
              <th className={`${th} text-left`}>Last contact</th>
              <th className={`${th} text-left`}>Why it&rsquo;s here</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {slice.map((item) => (
              <tr key={item.id} className="hover:bg-neutral-50 transition-colors" style={{ height: '4rem' }}>
                <td className="relative pl-6 pr-4 py-2">
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${urgencyBar[item.urgency]}`} aria-hidden="true" />
                  <Link
                    to={`/schools/${encodeURIComponent(item.id)}`}
                    className="block truncate font-medium text-neutral-800 hover:text-siue-red transition-colors"
                    title={item.name}
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="px-4 py-2 truncate text-neutral-600" title={item.county}>{item.county || <Missing label="No county" />}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-700">{item.contactCount}</td>
                <td className="px-4 py-2 whitespace-nowrap text-neutral-600">{item.lastContact}</td>
                {/* Up to two lines, the rest on hover: rows stay the same height. */}
                <td className="px-4 py-2 text-neutral-600"><span className="line-clamp-2" title={item.reason}>{item.reason}</span></td>
                <td className="px-4 py-2">
                  <RowActions>
                    {onLog && <RowAction icon={<Plus size={13} />} label="Log" tone="primary" title={`Log contact with ${item.name}`} onClick={() => onLog(item)} />}
                    <RowAction icon={<ExternalLink size={13} />} label="Open" title={`Open ${item.name}`} onClick={() => navigate(`/schools/${encodeURIComponent(item.id)}`)} />
                  </RowActions>
                </td>
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
  const { state } = useAppContext();
  const today = todayDay();
  // Kept in the address so the view survives leaving the tab, a refresh and Back:
  // which sections are open, and each list's page number.
  const [openRaw, setOpenRaw] = useUrlState('open');
  const openSections = new Set(openRaw.split(',').filter(Boolean));
  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenRaw([...next].join(','));
  };
  const [eventPage, setEventPage] = useUrlState('p_event', '1');
  const [quietPage, setQuietPage] = useUrlState('p_quiet', '1');
  const [neverPage, setNeverPage] = useUrlState('p_never', '1');
  const [noContactPage, setNoContactPage] = useUrlState('p_nocontact', '1');
  const pageNum = (v: string) => Math.max(1, Number(v) || 1);
  const [logFor, setLogFor] = useState<WorkItem | null>(null);

  const lists = useMemo(
    () => priorityLists(state.schools, state.contacts, state.activities, state.events, today),
    [state.schools, state.contacts, state.activities, state.events, today]
  );

  // The shared columns, so rows line up across sections.
  const rows = useMemo(() => {
    const school = new Map(state.schools.map((s) => [s.id, s]));
    const event = new Map(state.events.map((e) => [e.id, e]));
    const contacts = new Map<string, number>();
    for (const c of state.contacts) if (c.isActive) contacts.set(c.schoolId, (contacts.get(c.schoolId) ?? 0) + 1);
    const lastDay = new Map<string, string>();
    for (const a of state.activities) {
      const d = dayOf(a.date);
      if (d > today) continue;
      if (!lastDay.has(a.schoolId) || d > lastDay.get(a.schoolId)!) lastDay.set(a.schoolId, d);
    }
    const item = (id: string, reason: string, urgency: Urgency): WorkItem => {
      const s = school.get(id);
      const d = lastDay.get(id);
      return {
        id, name: s?.name ?? id, county: s?.county ?? '', contactCount: contacts.get(id) ?? 0,
        lastContact: d ? formatDay(d) : 'Never', reason, urgency,
      };
    };
    const eventName = (id?: string, fallback?: string) => (id ? event.get(id)?.name : undefined) ?? (fallback ? `“${fallback}”` : 'an event');
    const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    return {
      followUp: lists.followUp.map((x) => item(x.schoolId,
        `Attended ${eventName(x.eventId, x.description)} on ${formatDay(x.eventDay)}. ${x.daysLeft === 0 ? 'Last day' : plural(x.daysLeft, 'day') + ' left'} to follow up.`,
        x.daysLeft <= 14 ? 'overdue' : 'due')),
      quiet: lists.quiet.map((x) => item(x.schoolId,
        `Nothing since ${formatDay(x.lastDay)} (${plural(Math.floor(daysBetween(x.lastDay, today) / 30), 'month')}).`, 'overdue')),
      neverReached: lists.neverReached.map((x) => item(x.schoolId,
        x.upcoming
          ? `On ${eventName(x.upcoming.eventId)}, ${formatDay(x.upcoming.day)}. ${plural(x.activeContacts, 'contact')} on file, never contacted.`
          : `${plural(x.activeContacts, 'contact')} on file, never contacted.`,
        x.upcoming ? 'due' : 'cold')),
      noContact: lists.noContact.map((x) => {
        const s = school.get(x.schoolId);
        const why = x.lastDay
          ? 'Contacted, but no contact person on file.'
          : s?.sourceStatus === 'working' ? 'No contact person. The school website works: its staff page may list someone.'
          : s?.sourceStatus === 'broken' ? 'No contact person, and the website link is broken.'
          : s?.sourceStatus === 'not_found' ? 'No contact person, and no website found.'
          : 'No contact person on file.';
        return item(x.schoolId, why, x.lastDay ? 'due' : 'cold');
      }),
    };
  }, [lists, state.schools, state.events, state.contacts, state.activities, today]);

  const gaps = useMemo(
    () => countyGaps(state.schools, state.contacts, state.activities, today,
      (s) => countyKey(s.county, s.state), (s) => countyGroupName(s.county)),
    [state.schools, state.contacts, state.activities, today]
  );

  // When the first schools can go quiet: six months after logging started.
  const firstQuietDay = useMemo(() => {
    const start = loggingStatus(state.activities.filter((a) => dayOf(a.date) <= today)).start;
    return start ? addMonths(start, 6) : null;
  }, [state.activities, today]);

  // The four lists never overlap, so this is a plain sum.
  const waiting = lists.followUp.length + lists.quiet.length + lists.neverReached.length + lists.noContact.length;

  return (
    <div>
      <Header title="Priorities" subtitle="Schools waiting on you, most urgent first" />
      <div className="p-8 space-y-6">
        <p className="text-lg text-neutral-600 max-w-3xl">
          {waiting === 0 ? (
            <>Nothing is waiting. Every school has a contact person and recent outreach.</>
          ) : (
            <>
              <span className="font-semibold text-neutral-800">
                {waiting.toLocaleString()} of {state.schools.length.toLocaleString()} schools
              </span>{' '}
              are waiting on you. Each school is on one list only.
            </>
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <WorkSection
            icon={<Clock size={18} />}
            title="Follow up after an event"
            open={openSections.has('event')}
            onToggle={() => toggleSection('event')}
            description={`Attended an event in the last ${FOLLOW_UP_DAYS} days, with no call, email or visit since. Fewest days left first.`}
            count={lists.followUp.length}
            countTone="attention"
            emptyTitle="No follow-ups waiting"
            emptyBody="Every school that came to a recent event has heard from you since."
          >
            <WorkTable items={rows.followUp} onLog={canEdit ? setLogFor : undefined} page={pageNum(eventPage)} onPageChange={(n) => setEventPage(String(n))} />
          </WorkSection>

          <WorkSection
            icon={<Moon size={18} />}
            title="Gone quiet"
            open={openSections.has('quiet')}
            onToggle={() => toggleSection('quiet')}
            description={`Had outreach before, but nothing in ${QUIET_MONTHS} months. Longest silence first.`}
            count={lists.quiet.length}
            countTone="attention"
            emptyNeutral={!!firstQuietDay && firstQuietDay > today}
            emptyTitle={firstQuietDay && firstQuietDay > today ? 'Nobody can have gone quiet yet' : 'Nobody has gone quiet'}
            emptyBody={firstQuietDay && firstQuietDay > today
              ? `Logging started on ${formatDay(addMonths(firstQuietDay, -6))}, so this list starts filling in from ${formatDay(firstQuietDay)}, when the first schools reach ${QUIET_MONTHS} months without contact.`
              : `Every school with past outreach has been contacted in the last ${QUIET_MONTHS} months.`}
          >
            <WorkTable items={rows.quiet} onLog={canEdit ? setLogFor : undefined} page={pageNum(quietPage)} onPageChange={(n) => setQuietPage(String(n))} />
          </WorkSection>

          <WorkSection
            icon={<UserPlus size={18} />}
            title="Has contacts but never reached out"
            open={openSections.has('never')}
            onToggle={() => toggleSection('never')}
            description="A contact person on file, but nothing ever logged. Schools on an upcoming event first."
            count={lists.neverReached.length}
            countTone="neutral"
            emptyTitle="Every school with contacts has been reached"
          >
            <WorkTable items={rows.neverReached} onLog={canEdit ? setLogFor : undefined} page={pageNum(neverPage)} onPageChange={(n) => setNeverPage(String(n))} />
          </WorkSection>

          <WorkSection
            icon={<UserX size={18} />}
            title="No contact person on file"
            open={openSections.has('nocontact')}
            onToggle={() => toggleSection('nocontact')}
            description="No active contact to reach. Schools already contacted first, then those with a working website."
            count={lists.noContact.length}
            countTone="neutral"
            emptyTitle="Every school has a contact person"
          >
            <WorkTable items={rows.noContact} onLog={canEdit ? setLogFor : undefined} page={pageNum(noContactPage)} onPageChange={(n) => setNoContactPage(String(n))} />
          </WorkSection>

          <WorkSection
            icon={<MapPin size={18} />}
            title="Counties with the widest gaps"
            open={openSections.has('counties')}
            onToggle={() => toggleSection('counties')}
            description="Where the most schools have no contact person on file."
            count={gaps.length}
            countTone="neutral"
            emptyTitle="Every county has a contact person at every school"
          >
            <div className="divide-y divide-neutral-50">
              {gaps.slice(0, 12).map((c) => {
                const rate = c.total ? c.withContact / c.total : 0;
                const without = c.total - c.withContact;
                return (
                  <div key={countyKey(c.county, c.state)} className="relative">
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${rate < 0.34 ? urgencyBar.overdue : urgencyBar.due}`} aria-hidden="true" />
                    <div className="px-6 py-3">
                      <div className="flex items-center justify-between gap-4 mb-1.5">
                        <Link to={countyPath(c.county, c.state)} className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate">
                          {countyLabel(c.county, c.state)}
                        </Link>
                        <span className="text-xs text-neutral-600 shrink-0">
                          <span className="font-medium text-attention-high-text">{without} with no contact person</span>
                          {' · '}{c.neverContacted} never contacted
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div className="h-full bg-attention-medium rounded-full" style={{ width: `${Math.round(rate * 100)}%` }} />
                        </div>
                        <span className="text-xs text-neutral-500 shrink-0 text-right">
                          {c.withContact} of {c.total} have a contact person
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {gaps.length > 12 && (
              <div className="px-6 py-3 text-xs text-neutral-500 border-t border-neutral-100">
                Showing the 12 widest gaps of {gaps.length.toLocaleString()} counties.
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
