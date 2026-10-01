import { useState } from 'react';
import { Link2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Badge } from '../common/Badge';
import { useAppContext } from '../../context/AppContext';
import { setSchoolLinks } from '../../services/schoolsService';
import { normalizeLink, staffPageInUse, websiteInUse } from '../../utils/links';
import type { LinkInUse } from '../../utils/links';
import { websiteHref, websiteLabel } from '../../utils/helpers';
import type { School } from '../../types';

function Source({ link }: { link: LinkInUse }) {
  if (link.source === 'yours') return <Badge variant="info">Your link</Badge>;
  if (link.source === 'scraper') return <Badge variant="default">Found by the scraper</Badge>;
  return null;
}

function LinkRow({ label, link, empty, note }: { label: string; link: LinkInUse; empty: string; note?: string }) {
  return (
    <div className="py-2">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      {link.url ? (
        <div className="flex flex-wrap items-center gap-2">
          <a href={websiteHref(link.url)} target="_blank" rel="noopener noreferrer" className="text-sm text-info hover:underline break-all">
            {websiteLabel(link.url)}
          </a>
          <Source link={link} />
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{empty}</p>
      )}
      {note && <p className="text-xs text-neutral-500 mt-0.5">{note}</p>}
    </div>
  );
}

/**
 * The school's website and staff-page links, showing which is in use (the client's
 * own link or what the scraper found), and letting the client paste their own (db/013).
 */
export function SchoolLinks({ school }: { school: School }) {
  const { dispatch } = useAppContext();
  const [editing, setEditing] = useState(false);
  const [website, setWebsite] = useState('');
  const [staffPage, setStaffPage] = useState('');
  const [errors, setErrors] = useState<{ website?: string; staffPage?: string }>({});
  const [saving, setSaving] = useState(false);

  const site = websiteInUse(school);
  const staff = staffPageInUse(school);

  const start = () => {
    setWebsite(school.websiteOverride ?? '');
    setStaffPage(school.staffPageOverride ?? '');
    setErrors({});
    setEditing(true);
  };

  const save = async () => {
    const next: { websiteOverride: string | null; staffPageOverride: string | null } = { websiteOverride: null, staffPageOverride: null };
    const found: typeof errors = {};
    try { next.websiteOverride = normalizeLink(website); } catch (e) { found.website = (e as Error).message; }
    try { next.staffPageOverride = normalizeLink(staffPage); } catch (e) { found.staffPage = (e as Error).message; }
    setErrors(found);
    if (found.website || found.staffPage) return;
    setSaving(true);
    try {
      const updated = await setSchoolLinks(school.id, next);
      dispatch({ type: 'UPDATE_SCHOOL', payload: updated });
      toast.success('Links saved');
      setEditing(false);
    } catch (err) {
      console.error('setSchoolLinks failed:', err);
      toast.error('Could not save the links');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-neutral-500" />
          <h3 className="text-base font-semibold text-neutral-800">Links</h3>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={start}>
            <Pencil size={14} />
            Edit links
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3 mt-2">
          <Input
            label="Website"
            placeholder={school.website ? `Leave blank to use ${websiteLabel(school.website)}` : 'https://…'}
            helpText="Leave blank to use the website the scraper finds."
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            error={errors.website}
          />
          <Input
            label="Staff page"
            placeholder="https://…/staff-directory"
            helpText="The page that lists the school's staff. Leave blank to let the scraper look for it."
            value={staffPage}
            onChange={(e) => setStaffPage(e.target.value)}
            error={errors.staffPage}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save links'}</Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-neutral-100">
          <LinkRow
            label="Website"
            link={site}
            empty="No website on record."
            note={site.source === 'yours' && school.website ? `The scraper found ${websiteLabel(school.website)}` : undefined}
          />
          <LinkRow label="Staff page" link={staff} empty="Not set. The scraper looks for the staff page on each run." />
        </div>
      )}
    </Card>
  );
}
