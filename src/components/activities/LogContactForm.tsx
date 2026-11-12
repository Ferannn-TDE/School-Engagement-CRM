import { useState } from 'react';
import { format } from 'date-fns';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/useAppContext';
import { ContactMethodLabels, IN_PERSON_ACTIVITY_TYPES } from '../../types';
import { parseVisitors } from '../../utils/visitors';
import { specifyError } from '../../utils/labels';
import { activityDateError, futureDateNote, latestActivityDay } from '../../utils/activityDates';
import toast from 'react-hot-toast';
import { writeErrorMessage } from '../../utils/writeErrors';

interface LogContactFormProps {
  schoolId: string;
  onClose: () => void;
}

/** Records a call, email or visit with a school. Plain controlled state rather than
 *  react-hook-form: a few fields, and the rules are the date and the visitor count. */
export function LogContactForm({ schoolId, onClose }: LogContactFormProps) {
  const { addActivity, getContactsBySchool } = useAppContext();
  const contacts = getContactsBySchool(schoolId);
  const today = format(new Date(), 'yyyy-MM-dd');

  const [method, setMethod] = useState('call');
  const [methodOther, setMethodOther] = useState('');
  const [date, setDate] = useState(today);
  const [contactId, setContactId] = useState('');
  const [notes, setNotes] = useState('');
  const [visitorsText, setVisitorsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Past dates and up to a year ahead; a future one is saved as upcoming (utils/activityDates).
  const dateError = activityDateError(date);
  const isFuture = !dateError && date > today;
  // Only in-person types have visitors; a count typed before switching to a call is dropped.
  const inPerson = IN_PERSON_ACTIVITY_TYPES.includes(method);
  const visitors = inPerson ? parseVisitors(visitorsText) : { value: null, error: '' };
  const otherError = specifyError(method, methodOther);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError || visitors.error || otherError) return;
    setSaving(true);
    setError('');
    try {
      await addActivity({
        schoolId,
        contactId: contactId || undefined,
        activityType: method,
        activityTypeOther: method === 'other' ? methodOther.trim() : undefined,
        date,
        description: notes.trim(),
        attendeeCount: visitors.value ?? undefined,
      });
      toast.success('Contact logged');
      onClose();
    } catch (err) {
      // Keep the form open with everything the user typed, so nothing is lost.
      setError(writeErrorMessage(err, 'Couldn’t save this contact. Check your connection and try again — your notes are still here.'));
      setSaving(false);
    }
  };

  const methodOptions = Object.entries(ContactMethodLabels).map(([value, label]) => ({ value, label }));
  const contactOptions = contacts
    .slice()
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
    .map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() || c.email || 'Unnamed contact' }));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          id="log-contact-method"
          label="How"
          required
          options={methodOptions}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        />
        <Input
          id="log-contact-date"
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
      {/* Other: "Please specify" is required, and shown instead of "Other" (db/028). */}
      {method === 'other' && (
        <Input
          id="log-contact-method-other"
          label="Please specify"
          required
          placeholder="What kind of contact was it?"
          value={methodOther}
          error={otherError || undefined}
          onChange={(e) => setMethodOther(e.target.value)}
        />
      )}
      {inPerson && (
        <Input
          id="log-contact-visitors"
          label="Number of visitors"
          type="text"
          inputMode="numeric"
          placeholder="Leave blank if not counted"
          helpText="How many people came to this visit. Counted in Reports."
          value={visitorsText}
          error={visitors.error || undefined}
          onChange={(e) => setVisitorsText(e.target.value)}
        />
      )}
      <Select
        id="log-contact-person"
        label="Who you spoke to"
        placeholder={contacts.length ? 'Not a specific person' : 'No contacts on file for this school'}
        options={contactOptions}
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
      />
      <Textarea
        id="log-contact-notes"
        label="Notes"
        rows={3}
        placeholder="What was discussed, and any next step"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
        <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!!dateError || !!visitors.error || !!otherError}>
          Log contact
        </Button>
      </div>
    </form>
  );
}
