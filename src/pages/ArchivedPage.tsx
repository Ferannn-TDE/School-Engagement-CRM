import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card } from '../components/common/Card';
import { RowAction, RowActions } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAppContext } from '../context/useAppContext';
import { fetchArchivedItems, restoreItem } from '../services/archiveService';
import type { ArchivedItem, ArchivedKind } from '../services/archiveService';
import toast from 'react-hot-toast';
import { useRole } from '../context/useRole';
import { writeErrorMessage } from '../utils/writeErrors';
import { ColGroup, cellClass, headClass, tableProps, type ColumnSpec } from '../components/common/tableColumns';

/** Name, Archived (date and time), By, Actions. */
const COLUMNS: ColumnSpec[] = ['primary', { kind: 'date', width: '12rem' }, { kind: 'text', width: '16rem' }, 'actions'];

const SECTIONS: { kind: ArchivedKind; title: string; note?: string }[] = [
  { kind: 'school', title: 'Schools', note: 'Restoring a school also brings back the contacts archived with it.' },
  { kind: 'contact', title: 'Contacts' },
  { kind: 'event', title: 'Events' },
  { kind: 'program', title: 'Programs' },
  { kind: 'activity', title: 'Logged contacts' },
];

/**
 * Everything archived instead of deleted (db/009), by type, with who archived it and
 * when, and a Restore button.
 */
export function ArchivedPage() {
  const { reload } = useAppContext();
  const { canEdit } = useRole();
  const columns = canEdit ? COLUMNS : COLUMNS.slice(0, 3);
  const [items, setItems] = useState<ArchivedItem[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchArchivedItems());
    } catch (err) {
      console.error('fetchArchivedItems failed:', err);
      toast.error('Failed to load archived items');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byKind = useMemo(() => {
    const map = new Map<ArchivedKind, ArchivedItem[]>();
    for (const item of items ?? []) map.set(item.kind, [...(map.get(item.kind) ?? []), item]);
    return map;
  }, [items]);

  const restore = async (item: ArchivedItem) => {
    const key = `${item.kind}:${item.id}`;
    setRestoring(key);
    try {
      await restoreItem(item.kind, item.id);
      toast.success(`Restored "${item.label}"`);
      await Promise.all([load(), reload()]);
    } catch (err) {
      console.error('restoreItem failed:', err);
      toast.error(writeErrorMessage(err, `Failed to restore "${item.label}"`));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div>
      <Breadcrumb crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Archived' }]} />
      <Header
        title="Archived"
        subtitle="Nothing is deleted. Archived items are hidden everywhere else and can be restored here."
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {items === null ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Archive size={32} />}
              title="Nothing archived"
              description="Archived schools, contacts, events, programs and logged contacts will appear here."
            />
          </Card>
        ) : (
          SECTIONS.filter((s) => byKind.has(s.kind)).map((section) => (
            <Card key={section.kind} padding={false}>
              <div className="px-6 pt-5 pb-3">
                <h2 className="text-base font-semibold text-neutral-800">
                  {section.title} <span className="text-neutral-400 font-normal">({byKind.get(section.kind)!.length})</span>
                </h2>
                {section.note && <p className="text-xs text-neutral-500 mt-0.5">{section.note}</p>}
              </div>
              <div className="overflow-x-auto pb-2">
                <table {...tableProps(columns, 'text-sm')}>
                  <ColGroup specs={columns} />
                  <thead className="bg-neutral-50 border-y border-neutral-100">
                    <tr>
                      <th className={`${headClass(COLUMNS[0])} pl-6`}>Name</th>
                      <th className={headClass(COLUMNS[1])}>Archived</th>
                      <th className={headClass(COLUMNS[2])}>By</th>
                      {canEdit && <th className={`${headClass(COLUMNS[3])} pr-6`}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {byKind.get(section.kind)!.map((item) => (
                      <tr key={item.id} style={{ height: '4rem' }}>
                        <td className={`${cellClass(COLUMNS[0])} pl-6`}>
                          <p className="truncate font-medium text-neutral-800" title={item.label}>{item.label}</p>
                          {item.detail && <p className="truncate text-xs text-neutral-500" title={item.detail}>{item.detail}</p>}
                        </td>
                        <td className={`${cellClass(COLUMNS[1])} text-neutral-600`}>
                          {item.archivedAt ? format(new Date(item.archivedAt), 'MMM d, yyyy h:mm a') : <Missing label="Not recorded" />}
                        </td>
                        <td className={`${cellClass(COLUMNS[2])} truncate text-neutral-600`} title={item.archivedBy ?? undefined}>{item.archivedBy ?? <Missing label="Not recorded" />}</td>
                        {canEdit && (
                          <td className={`${cellClass(COLUMNS[3])} pr-6`}>
                            <RowActions>
                              <RowAction
                                icon={<RotateCcw size={13} />}
                                label={restoring === `${item.kind}:${item.id}` ? 'Restoring…' : 'Restore'}
                                disabled={restoring !== null}
                                onClick={() => void restore(item)}
                              />
                            </RowActions>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
