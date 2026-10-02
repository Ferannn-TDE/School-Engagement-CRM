import { useState } from 'react';
import { Globe } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { resolveSchoolPending } from '../../services/schoolsService';
import { resolveContactPending } from '../../services/contactsService';
import { displayValue, fieldLabel, openPending } from '../../utils/pending';
import type { OpenPending } from '../../utils/pending';
import type { Contact, School } from '../../types';

/** The value the client has now, for "(you have …)". */
function schoolValue(s: School, column: string): unknown {
  const map: Record<string, unknown> = {
    name: s.name, phone: s.phone, address: s.address, city: s.city, zipcode: s.zipCode,
    website: s.website, county_name: s.county, enrollment: s.enrollment, grade_range: s.gradeRange,
    notes: s.notes, state_code: s.state, is_active: s.isActive,
  };
  return map[column];
}

function contactValue(c: Contact, column: string): unknown {
  const map: Record<string, unknown> = {
    name: `${c.firstName} ${c.lastName}`.trim(), email: c.email, phone: c.phone, job_name: c.title,
    is_active: c.isActive, notes: c.notes, school_worked_at: c.schoolId,
  };
  return map[column];
}

interface Item {
  key: string;
  who: string | null;
  pending: OpenPending;
  current: unknown;
  resolve: (choice: 'use' | 'keep') => Promise<void>;
}

/**
 * For every field a person locked where the scraper has since found something
 * different: "The website now says X — keep yours or use this?" (db/012).
 * Use this applies the website's value and removes the lock; keep yours leaves both
 * and isn't asked again unless the website changes to yet another value.
 */
export function WebsiteUpdates({ school, contacts }: { school: School; contacts: Contact[] }) {
  const { dispatch } = useAppContext();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const me = user?.email ?? 'unknown';

  const items: Item[] = [
    ...openPending(school.pendingScraped, school.lockedFields).map((p) => ({
      key: `school:${p.column}`,
      who: null,
      pending: p,
      current: schoolValue(school, p.column),
      resolve: async (choice: 'use' | 'keep') => {
        const updated = await resolveSchoolPending(school.id, p.column, choice, me);
        dispatch({ type: 'UPDATE_SCHOOL', payload: updated });
      },
    })),
    ...contacts.flatMap((c) =>
      openPending(c.pendingScraped, c.lockedFields).map((p) => ({
        key: `contact:${c.id}:${p.column}`,
        who: `${c.firstName} ${c.lastName}`.trim(),
        pending: p,
        current: contactValue(c, p.column),
        resolve: async (choice: 'use' | 'keep') => {
          const updated = await resolveContactPending(c, p.column, choice, me);
          dispatch({ type: 'UPDATE_CONTACT', payload: updated });
        },
      }))
    ),
  ];

  if (items.length === 0) return null;

  const answer = async (item: Item, choice: 'use' | 'keep') => {
    setBusy(item.key);
    try {
      await item.resolve(choice);
      toast.success(choice === 'use' ? 'Updated from the website' : 'Kept your value');
    } catch (err) {
      console.error('resolve pending failed:', err);
      toast.error('Could not save your answer');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Updates from the website" className="rounded-xl border border-info/30 bg-blue-50/40 p-6">
      <div className="flex items-center gap-2 mb-1">
        <Globe size={18} className="text-info" />
        <h3 className="text-base font-semibold text-neutral-800">
          Updates from the website ({items.length})
        </h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        These details differ from what the website shows. Keep the current value or use the new one.
      </p>
      <ul className="divide-y divide-neutral-200">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 text-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                {item.who ? `${item.who} · ` : ''}{fieldLabel(item.pending.column)}
              </p>
              <p className="text-neutral-800">
                The website now says <strong>{displayValue(item.pending.value)}</strong> — keep yours or use this?
              </p>
              <p className="text-xs text-neutral-500">
                You have {displayValue(item.current)} · found {format(new Date(item.pending.seenAt), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void answer(item, 'keep')}>
                Keep yours
              </Button>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void answer(item, 'use')}>
                Use this
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
