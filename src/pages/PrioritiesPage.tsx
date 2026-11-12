import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  School, Clock, MapPin, CheckCircle2, Plus, ExternalLink, UserPlus, UserX, Download,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { LogContactForm } from '../components/activities/LogContactForm';
import { useAppContext } from '../context/useAppContext';
import { priorityLists, countyGaps } from '../utils/priorities';
import { dayOf, formatDay } from '../utils/reports';
import { activityTypeLabel } from '../utils/reportLists';
import { classNames } from '../utils/helpers';
import { todayDay } from '../utils/activityDates';
import { countyGroupName, countyKey, countyLabel, countyPath } from '../utils/counties';
import { useUrlState } from '../hooks/useUrlState';
import { useRole } from '../context/useRole';
import { Pagination } from '../components/common/Pagination';
import { RowAction, RowActions } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';
import { RECENT_CONTACT_DAYS } from '../constants/reportSettings';

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

type ListKey = 'recent' | 'never' | 'nocontact' | 'counties';

/** One of the four equal boxes in the grid. The chosen one shows its list below. */
function ListTile({ icon, title, description, count, selected, onSelect }: {
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={classNames(
        'h-full w-full rounded-xl border bg-white px-6 py-5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red',
        selected ? 'border-siue-red ring-1 ring-siue-red' : 'border-neutral-100 shadow-sm hover:bg-neutral-50'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 shrink-0 text-neutral-400">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
            <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
          </div>
        </div>
        <Badge variant={count === 0 ? 'success' : 'info'}>{count.toLocaleString()}</Badge>
      </div>
      <p className="mt-3 text-xs font-medium text-siue-red">{selected ? 'Showing below' : 'Show list'}</p>
    </button>
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
  const navigate = useNavigate();
  const today = todayDay();
  // Kept in the address so the view survives leaving the tab, a refresh and Back:
  // which list is open, and each list's page number.
  const [listRaw, setList] = useUrlState('list', 'recent');
  const list: ListKey = (['recent', 'never', 'nocontact', 'counties'] as const).includes(listRaw as ListKey) ? (listRaw as ListKey) : 'recent';
  const [recentPage, setRecentPage] = useUrlState('p_recent', '1');
  const [neverPage, setNeverPage] = useUrlState('p_never', '1');
  const [noContactPage, setNoContactPage] = useUrlState('p_nocontact', '1');
  const pageNum = (v: string) => Math.max(1, Number(v) || 1);
  const [logFor, setLogFor] = useState<WorkItem | null>(null);

  const lists = useMemo(
    () => priorityLists(state.schools, state.contacts, state.activities, state.events, today),
    [state.schools, state.contacts, state.activities, state.events, today]
  );

  // The shared columns, so rows line up across lists.
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
    const item = (id: string, reason: string, urgency: Urgency, lastContact?: string): WorkItem => {
      const s = school.get(id);
      const d = lastDay.get(id);
      return {
        id, name: s?.name ?? id, county: s?.county ?? '', contactCount: contacts.get(id) ?? 0,
        lastContact: lastContact ?? (d ? formatDay(d) : 'Never'), reason, urgency,
      };
    };
    const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    return {
      recent: lists.recent.map((x) => item(x.schoolId,
        x.daysLeft === 0 ? 'Leaves the list tomorrow.' : `Leaves the list in ${plural(x.daysLeft, 'day')}.`,
        x.daysLeft <= 14 ? 'overdue' : 'due',
        `${formatDay(x.lastDay)} · ${activityTypeLabel(x.lastType)}`)),
      neverReached: lists.neverReached.map((x) => item(x.schoolId,
        x.upcoming
          ? `On ${event.get(x.upcoming.eventId)?.name ?? 'an event'}, ${formatDay(x.upcoming.day)}. ${plural(x.activeContacts, 'contact')} on file, never contacted.`
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

  // Generate Lists, limited to these schools' contacts (for event invites). The school
  // list travels with the page change, not in the address, so the link stays short.
  const exportContacts = (schoolIds: string[], label: string) =>
    navigate('/generate', { state: { schoolIds, label } });

  // The three lists never overlap, so this is a plain sum.
  const total = lists.recent.length + lists.neverReached.length + lists.noContact.length;

  const tiles: { key: ListKey; icon: ReactNode; title: string; description: string; count: number }[] = [
    { key: 'recent', icon: <Clock size={18} />, title: 'Recently in touch: keep the connection going',
      description: `Any visit, call, email or event in the last ${RECENT_CONTACT_DAYS} days. Oldest contact first.`, count: lists.recent.length },
    { key: 'never', icon: <UserPlus size={18} />, title: 'Has contacts but never reached out',
      description: 'A contact person on file, but nothing ever logged. Schools on an upcoming event first.', count: lists.neverReached.length },
    { key: 'nocontact', icon: <UserX size={18} />, title: 'No contact person on file',
      description: 'No active contact to reach. Schools already contacted first, then those with a working website.', count: lists.noContact.length },
    { key: 'counties', icon: <MapPin size={18} />, title: 'Counties with the widest gaps',
      description: 'Where the most schools have no contact person on file.', count: gaps.length },
  ];
  const chosen = tiles.find((t) => t.key === list)!;
  const exportable = list === 'recent' ? lists.recent : list === 'never' ? lists.neverReached : null;

  return (
    <div>
      <Header title="Priorities" subtitle="Schools waiting on you, most urgent first" />
      <div className="p-8 space-y-6">
        <p className="text-lg text-neutral-600 max-w-3xl">
          <span className="font-semibold text-neutral-800">{lists.recent.length.toLocaleString()} schools</span> were in touch in the last {RECENT_CONTACT_DAYS} days,{' '}
          <span className="font-semibold text-neutral-800">{lists.neverReached.length.toLocaleString()}</span> have contacts but were never reached, and{' '}
          <span className="font-semibold text-neutral-800">{lists.noContact.length.toLocaleString()}</span> have no contact person:{' '}
          {total.toLocaleString()} of {state.schools.length.toLocaleString()} schools, each on one list only.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 auto-rows-fr gap-5">
          {tiles.map((t) => (
            <ListTile key={t.key} icon={t.icon} title={t.title} description={t.description} count={t.count}
              selected={list === t.key} onSelect={() => setList(t.key)} />
          ))}
        </div>

        <Card padding={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-neutral-100">
            <div>
              <h2 className="text-base font-semibold text-neutral-800">{chosen.title}</h2>
              <p className="text-sm text-neutral-500">{chosen.count.toLocaleString()} {list === 'counties' ? 'counties' : 'schools'}</p>
            </div>
            {exportable && exportable.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => exportContacts(exportable.map((x) => x.schoolId), chosen.title)}>
                <Download size={14} />
                Export contacts
              </Button>
            )}
          </div>
          {chosen.count === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-3 text-success opacity-60" />
              <p className="text-sm font-medium text-success">Nothing here</p>
            </div>
          ) : list === 'recent' ? (
            <WorkTable items={rows.recent} onLog={canEdit ? setLogFor : undefined} page={pageNum(recentPage)} onPageChange={(n) => setRecentPage(String(n))} />
          ) : list === 'never' ? (
            <WorkTable items={rows.neverReached} onLog={canEdit ? setLogFor : undefined} page={pageNum(neverPage)} onPageChange={(n) => setNeverPage(String(n))} />
          ) : list === 'nocontact' ? (
            <WorkTable items={rows.noContact} onLog={canEdit ? setLogFor : undefined} page={pageNum(noContactPage)} onPageChange={(n) => setNoContactPage(String(n))} />
          ) : (
            <>
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
            </>
          )}
        </Card>

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
