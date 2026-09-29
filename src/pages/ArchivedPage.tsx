import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAppContext } from '../context/AppContext';
import { fetchArchivedItems, restoreItem } from '../services/archiveService';
import type { ArchivedItem, ArchivedKind } from '../services/archiveService';
import toast from 'react-hot-toast';

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
      toast.error(`Failed to restore "${item.label}"`);
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
      <div className="p-8 space-y-6 max-w-4xl">
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
              <ul className="divide-y divide-neutral-100">
                {byKind.get(section.kind)!.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-800 truncate">{item.label}</p>
                      {item.detail && <p className="text-xs text-neutral-500 truncate">{item.detail}</p>}
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Archived
                        {item.archivedAt ? ` ${format(new Date(item.archivedAt), 'MMM d, yyyy h:mm a')}` : ''}
                        {item.archivedBy ? ` by ${item.archivedBy}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void restore(item)}
                      disabled={restoring !== null}
                    >
                      <RotateCcw size={14} />
                      {restoring === `${item.kind}:${item.id}` ? 'Restoring…' : 'Restore'}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
