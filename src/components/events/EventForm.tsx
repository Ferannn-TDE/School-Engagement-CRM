import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Search, X } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/useAppContext';
import { EventType, EventTypeLabels } from '../../types';
import type { Event } from '../../types';
import toast from 'react-hot-toast';

// Keep attendeeCount as a string in the form; convert to number on submit
const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  // Starts blank and must be chosen, so no event is saved as "Outreach Fair" by default.
  type: z.string().min(1, 'Choose an event type'),
  date: z.string().min(1, 'Date is required'),
  endDate: z.string().optional(),
  // Optional: 25 events from school calendars have no location, and requiring one
  // made them impossible to save.
  location: z.string().optional(),
  attendeeCountStr: z.string().optional(),
  notes: z.string().optional(),
  participatingSchools: z.array(z.string()),
  // Other: "Please specify" is required, and shown instead of "Other" (db/028).
  typeOther: z.string().optional(),
}).refine((d) => d.type !== 'other' || !!d.typeOther?.trim(), { path: ['typeOther'], message: 'Please specify' });

type EventFormData = z.infer<typeof eventSchema>;

interface EventFormProps {
  event?: Event;
  onClose: () => void;
  /** Called with a new event once it's saved (the event picker selects it). */
  onCreated?: (event: Event) => void;
  /** A starting date for a new event, "yyyy-MM-dd". */
  initialDate?: string;
}

export function EventForm({ event, onClose, onCreated, initialDate }: EventFormProps) {
  const { state, addEvent, updateEvent } = useAppContext();
  const isEditing = !!event;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    setValue,
  } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: event
      ? {
          name: event.name,
          // Events saved before db/028 have no type: the form asks for one.
          type: event.type ?? '',
          typeOther: event.typeOther ?? '',
          date: event.date.slice(0, 16),
          endDate: event.endDate?.slice(0, 16) || '',
          location: event.location,
          attendeeCountStr: event.attendeeCount ? String(event.attendeeCount) : '',
          notes: event.notes || '',
          participatingSchools: event.participatingSchools,
        }
      : {
          type: '',
          typeOther: '',
          date: initialDate ? `${initialDate}T09:00` : '',
          participatingSchools: [],
          attendeeCountStr: '',
        },
  });

  const selectedSchools = watch('participatingSchools');
  const [schoolQuery, setSchoolQuery] = useState('');

  const schoolById = useMemo(() => new Map(state.schools.map((s) => [s.id, s])), [state.schools]);
  const pickableSchools = useMemo(
    () => state.schools.filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [state.schools]
  );
  // Name, city or county; every word must match somewhere ("alton madison").
  const shownSchools = useMemo(() => {
    const words = schoolQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return pickableSchools;
    return pickableSchools.filter((s) => {
      const text = `${s.name} ${s.city} ${s.county}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [pickableSchools, schoolQuery]);

  const onSubmit = async (data: EventFormData) => {
    const attendeeCount =
      data.attendeeCountStr && data.attendeeCountStr !== ''
        ? parseInt(data.attendeeCountStr, 10)
        : undefined;

    const eventData = {
      name: data.name,
      type: data.type as EventType,
      typeOther: data.type === 'other' ? data.typeOther?.trim() : undefined,
      date: new Date(data.date).toISOString(),
      endDate: data.endDate ? new Date(data.endDate).toISOString() : undefined,
      location: data.location ?? '',
      notes: data.notes || undefined,
      attendeeCount,
      participatingSchools: data.participatingSchools,
    };

    if (isEditing && event) {
      const changes: Partial<Event> = { ...eventData };
      updateEvent({ ...event, ...changes }, changes);
      toast.success('Event updated successfully');
    } else {
      const created = await addEvent(eventData);
      if (!created) return; // the error is shown; the form stays open with what was typed
      toast.success('Event created successfully');
      onCreated?.(created);
    }
    onClose();
  };

  const typeOptions = Object.values(EventType).map((type) => ({
    value: type,
    label: EventTypeLabels[type],
  }));

  const toggleSchool = (schoolId: string) => {
    const current = selectedSchools || [];
    if (current.includes(schoolId)) {
      setValue('participatingSchools', current.filter((id) => id !== schoolId));
    } else {
      setValue('participatingSchools', [...current, schoolId]);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Event Name"
        required
        error={errors.name?.message}
        {...register('name')}
      />
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Event Type"
          required
          placeholder="Choose a type"
          options={typeOptions}
          error={errors.type?.message}
          {...register('type')}
        />
        <Input
          label="Location"
          error={errors.location?.message}
          {...register('location')}
        />
      </div>
      {watch('type') === 'other' && (
        <Input
          label="Please specify"
          required
          placeholder="What kind of event is it?"
          error={errors.typeOther?.message}
          {...register('typeOther')}
        />
      )}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Start Date & Time"
          type="datetime-local"
          required
          error={errors.date?.message}
          {...register('date')}
        />
        <Input
          label="End Date & Time"
          type="datetime-local"
          error={errors.endDate?.message}
          {...register('endDate')}
        />
      </div>
      <Input
        label="Attendee Count"
        type="number"
        min={0}
        placeholder="0"
        {...register('attendeeCountStr')}
      />

      {/* School Selection */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label htmlFor="event-school-search" className="block text-sm font-medium text-neutral-700">
            Participating Schools
          </label>
          <span className="text-xs text-neutral-500" aria-live="polite">
            {selectedSchools?.length ?? 0} selected
          </span>
        </div>
        {selectedSchools && selectedSchools.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mb-2" aria-label="Selected schools">
            {selectedSchools.map((id) => {
              const s = schoolById.get(id);
              const name = s?.name ?? 'Unknown school';
              return (
                <li key={id} className="inline-flex items-center gap-1 rounded-full border border-siue-red/30 bg-siue-red/5 pl-2.5 pr-1 py-0.5 text-xs text-neutral-800">
                  <span className="max-w-[16rem] truncate" title={s ? `${s.name} (${[s.city, s.county].filter(Boolean).join(', ')})` : name}>{name}</span>
                  <button
                    type="button"
                    onClick={() => toggleSchool(id)}
                    className="rounded-full p-0.5 text-neutral-500 hover:bg-siue-red/10 hover:text-siue-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red"
                    aria-label={`Remove ${name}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            id="event-school-search"
            type="search"
            value={schoolQuery}
            onChange={(e) => setSchoolQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            placeholder="Search by name, city or county"
            className="w-full rounded-lg border border-neutral-200 pl-8 pr-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:border-siue-red focus:ring-siue-red/30"
          />
        </div>
        <div className="border border-neutral-200 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
          {shownSchools.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-neutral-500">No schools match “{schoolQuery.trim()}”.</p>
          )}
          {shownSchools.map((school) => (
              <label
                key={school.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedSchools?.includes(school.id) || false}
                  onChange={() => toggleSchool(school.id)}
                  className="rounded border-neutral-300 text-siue-red focus:ring-siue-red"
                />
                <span className="text-sm text-neutral-700">{school.name}</span>
                <span className="text-xs text-neutral-500">({[school.city, school.county].filter(Boolean).join(', ')})</span>
              </label>
            ))}
        </div>
      </div>

      <Textarea
        label="Notes"
        rows={3}
        {...register('notes')}
      />
      <div className="flex justify-end gap-3 pt-4 border-t border-neutral-100">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? 'Update Event' : 'Create Event'}
        </Button>
      </div>
    </form>
  );
}
