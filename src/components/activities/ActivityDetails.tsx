import { useEffect, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Archive, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { useAppContext } from '../../context/useAppContext';
import { useRole } from '../../context/useRole';
import { IN_PERSON_ACTIVITY_TYPES } from '../../types';
import type { ActivityRecord } from '../../types';
import { activityTypeLabel } from '../../utils/reportLists';
import { parseVisitors, visitorsLabel } from '../../utils/visitors';
import { activityDateError, futureDateNote, hasHappened, latestActivityDay, todayDay } from '../../utils/activityDates';
import { writeErrorMessage } from '../../utils/writeErrors';
import { fetchImportBatch, type ImportBatch } from '../../services/importBatchesService';
import { EventPicker } from '../events/EventPicker';

/** Every type an activity can have: the three Log contact methods and imported attendance. */
const ACTIVITY_TYPES = ['call', 'email', 'visit', 'event_participation'];

interface ActivityDetailsProps {
  activity: ActivityRecord;
  onClose: () => void;
  /** Opens the page's archive confirm; the panel never archives on its own. */
  onArchive: (id: string) => void;
}

const stamp = (iso: string) => format(new Date(iso), 'MMM d, yyyy h:mm a');

/**
 * One logged activity, from a school's Activity History: everything about it, who
 * logged it and who last edited it (db/026), and the import it came from. Editors can
 * edit it here; viewers see it read-only.
 */
export function ActivityDetails({ activity, onClose, onArchive }: ActivityDetailsProps) {
  const { state, getContactsBySchool, updateActivity } = useAppContext();
  const { canEdit } = useRole();
  const [editing, setEditing] = useState(false);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [batchError, setBatchError] = useState(false);

  useEffect(() => {
    if (!activity.importBatchId) return;
    let live = true;
    fetchImportBatch(activity.importBatchId)
      .then((b) => { if (live) setBatch(b); })
      .catch(() => { if (live) setBatchError(true); });
    return () => { live = false; };
  }, [activity.importBatchId]);

  const contacts = getContactsBySchool(activity.schoolId);
  const person = contacts.find((c) => c.id === activity.contactId);
  const event = activity.eventId ? state.events.find((e) => e.id === activity.eventId) : undefined;
  const upcoming = !hasHappened(activity);

  const loggedBy = activity.createdBy
    ?? (batch?.createdBy ? `${batch.createdBy} (imported)` : undefined);

  if (editing) {
    return (
      <ActivityEditForm
        activity={activity}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
        save={updateActivity}
      />
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Field label="Type">
          {activityTypeLabel(activity.activityType)}
          {upcoming && <Badge variant="info" className="ml-2 align-middle">Upcoming</Badge>}
        </Field>
        <Field label="Date">{format(new Date(activity.date), 'EEEE, MMM d, yyyy')}</Field>
        {/* Calls and emails have no visitors: the row only shows for in-person types. */}
        {IN_PERSON_ACTIVITY_TYPES.includes(activity.activityType) && (
          <Field label="Number of visitors">
            {activity.attendeeCount != null ? visitorsLabel(activity.attendeeCount) : <Muted>Not recorded</Muted>}
          </Field>
        )}
        <Field label="Who you spoke to">
          {person ? `${person.firstName} ${person.lastName}`.trim() || person.email : activity.contactId ? <Muted>A contact no longer at this school</Muted> : <Muted>Not a specific person</Muted>}
        </Field>
        <Field label="Event" wide>
          {event ? `${event.name} (${format(new Date(event.date), 'MMM d, yyyy')})` : activity.eventId ? <Muted>An archived event</Muted> : <Muted>None</Muted>}
        </Field>
        <Field label="Description" wide>
          {activity.description
            ? <span className="whitespace-pre-wrap">{activity.description}</span>
            : <Muted>No description</Muted>}
        </Field>
        {activity.outcome && <Field label="Outcome" wide>{activity.outcome}</Field>}
      </dl>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-neutral-100 pt-4">
        <Field label="Logged by">
          {loggedBy ?? <Muted>Not recorded (logged before this was tracked)</Muted>}
        </Field>
        <Field label="Last edited">
          {activity.updatedAt
            ? <>{activity.updatedBy ?? 'Unknown'} <span className="text-neutral-500">· {stamp(activity.updatedAt)}</span></>
            : <Muted>Not edited</Muted>}
        </Field>
        {activity.importBatchId && (
          <Field label="Import" wide>
            {batch ? (
              <>
                {batch.fileName}
                <span className="text-neutral-500">
                  {' '}· imported {stamp(batch.createdAt)}{batch.createdBy ? ` by ${batch.createdBy}` : ''}
                  {batch.archived ? ' · batch archived' : ''}
                </span>
              </>
            ) : batchError ? <Muted>Couldn’t load the import details</Muted> : <Muted>Loading…</Muted>}
          </Field>
        )}
      </dl>

      <div className="flex flex-wrap justify-between gap-3 pt-4 border-t border-neutral-100">
        {canEdit ? (
          <Button variant="ghost" type="button" onClick={() => onArchive(activity.id)} className="text-neutral-700 hover:text-error">
            <Archive size={14} /> Archive
          </Button>
        ) : <span />}
        <div className="flex gap-3">
          <Button variant="ghost" type="button" onClick={onClose}>Close</Button>
          {canEdit && (
            <Button type="button" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-800">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-neutral-400">{children}</span>;
}

/** The edit form: the same rules as Log contact (date up to a year ahead, visitors on in-person types). */
function ActivityEditForm({ activity, onCancel, onSaved, save }: {
  activity: ActivityRecord;
  onCancel: () => void;
  onSaved: () => void;
  save: ReturnType<typeof useAppContext>['updateActivity'];
}) {
  const { getContactsBySchool } = useAppContext();
  const today = todayDay();
  const [type, setType] = useState(activity.activityType);
  const [date, setDate] = useState(activity.date.slice(0, 10));
  const [contactId, setContactId] = useState(activity.contactId ?? '');
  const [eventId, setEventId] = useState(activity.eventId ?? '');
  const [visitorsText, setVisitorsText] = useState(activity.attendeeCount != null ? String(activity.attendeeCount) : '');
  const [notes, setNotes] = useState(activity.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dateError = activityDateError(date);
  const isFuture = !dateError && date > today;
  const inPerson = IN_PERSON_ACTIVITY_TYPES.includes(type);
  const visitors = inPerson ? parseVisitors(visitorsText) : { value: null, error: '' };

  const typeOptions = [...new Set([...ACTIVITY_TYPES, activity.activityType])]
    .map((t) => ({ value: t, label: activityTypeLabel(t) }));
  const contactOptions = getContactsBySchool(activity.schoolId)
    .slice()
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    .map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() || c.email || 'Unnamed contact' }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError || visitors.error) return;
    setSaving(true);
    setError('');
    try {
      await save(activity.id, {
        activityType: type,
        date,
        description: notes.trim(),
        contactId: contactId || null,
        eventId: eventId || null,
        // A call or email has no visitors: switching to one clears the count.
        attendeeCount: visitors.value,
      });
      toast.success('Activity updated');
      onSaved();
    } catch (err) {
      setError(writeErrorMessage(err, 'Couldn’t save the changes. Check your connection and try again; what you typed is still here.'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select id="activity-edit-type" label="Type" required options={typeOptions} value={type} onChange={(e) => setType(e.target.value)} />
        <Input
          id="activity-edit-date"
          label="Date"
          type="date"
          required
          max={latestActivityDay()}
          value={date}
          error={dateError || undefined}
          helpText={isFuture ? futureDateNote(date) : undefined}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {inPerson && (
        <Input
          id="activity-edit-visitors"
          label="Number of visitors"
          type="text"
          inputMode="numeric"
          placeholder="Leave blank if not counted"
          helpText="How many people came. Counted in Reports."
          value={visitorsText}
          error={visitors.error || undefined}
          onChange={(e) => setVisitorsText(e.target.value)}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          id="activity-edit-contact"
          label="Who you spoke to"
          placeholder={contactOptions.length ? 'Not a specific person' : 'No contacts on file for this school'}
          options={contactOptions}
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        />
        <EventPicker
          id="activity-edit-event"
          label="Event"
          value={eventId}
          near={date}
          allowCreate
          onChange={(id) => setEventId(id)}
        />
      </div>
      <Textarea id="activity-edit-notes" label="Description" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {activity.importBatchId && (
        <p className="text-xs text-neutral-500">
          This activity came from an import. Editing it changes only this activity; archiving the import still includes it.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={!!dateError || !!visitors.error}>Save changes</Button>
      </div>
    </form>
  );
}
