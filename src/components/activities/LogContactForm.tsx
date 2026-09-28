import { useState } from 'react';
import { format } from 'date-fns';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { ContactMethodLabels } from '../../types';
import toast from 'react-hot-toast';

interface LogContactFormProps {
  schoolId: string;
  onClose: () => void;
}

/** Records a call, email or visit with a school. Plain controlled state rather than
 *  react-hook-form: four fields, and the only rule is "the date can't be in the future". */
export function LogContactForm({ schoolId, onClose }: LogContactFormProps) {
  const { addActivity, getContactsBySchool } = useAppContext();
  const contacts = getContactsBySchool(schoolId);
  const today = format(new Date(), 'yyyy-MM-dd');

  const [method, setMethod] = useState('call');
  const [date, setDate] = useState(today);
  const [contactId, setContactId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dateError = !date ? 'Date is required' : date > today ? 'Date can’t be in the future' : '';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError) return;
    setSaving(true);
    setError('');
    try {
      await addActivity({
        schoolId,
        contactId: contactId || undefined,
        activityType: method,
        date,
        description: notes.trim(),
      });
      toast.success('Contact logged');
      onClose();
    } catch {
      // Keep the form open with everything the user typed, so nothing is lost.
      setError('Couldn’t save this contact. Check your connection and try again — your notes are still here.');
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
          max={today}
          value={date}
          error={dateError || undefined}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
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
        <Button type="submit" loading={saving} disabled={!!dateError}>
          Log contact
        </Button>
      </div>
    </form>
  );
}
