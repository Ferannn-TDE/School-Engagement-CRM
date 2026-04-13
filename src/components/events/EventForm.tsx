import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';
import { EventType, EventTypeLabels } from '../../types';
import type { Event } from '../../types';
import toast from 'react-hot-toast';

// Keep attendeeCount as a string in the form; convert to number on submit
const eventSchema = z.object({
  name: z.string().min(1, 'Event name is required'),
  type: z.nativeEnum(EventType),
  date: z.string().min(1, 'Date is required'),
  endDate: z.string().optional(),
  location: z.string().min(1, 'Location is required'),
  attendeeCountStr: z.string().optional(),
  notes: z.string().optional(),
  participatingSchools: z.array(z.string()),
});

type EventFormData = z.infer<typeof eventSchema>;

interface EventFormProps {
  event?: Event;
  onClose: () => void;
}

export function EventForm({ event, onClose }: EventFormProps) {
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
          type: event.type,
          date: event.date.slice(0, 16),
          endDate: event.endDate?.slice(0, 16) || '',
          location: event.location,
          attendeeCountStr: event.attendeeCount ? String(event.attendeeCount) : '',
          notes: event.notes || '',
          participatingSchools: event.participatingSchools,
        }
      : {
          type: EventType.OUTREACH_FAIR,
          participatingSchools: [],
          attendeeCountStr: '',
        },
  });

  const selectedSchools = watch('participatingSchools');

  const onSubmit = (data: EventFormData) => {
    const attendeeCount =
      data.attendeeCountStr && data.attendeeCountStr !== ''
        ? parseInt(data.attendeeCountStr, 10)
        : undefined;

    const eventData = {
      name: data.name,
      type: data.type,
      date: new Date(data.date).toISOString(),
      endDate: data.endDate ? new Date(data.endDate).toISOString() : undefined,
      location: data.location,
      notes: data.notes || undefined,
      attendeeCount,
      participatingSchools: data.participatingSchools,
    };

    if (isEditing && event) {
      updateEvent({ ...event, ...eventData });
      toast.success('Event updated successfully');
    } else {
      addEvent(eventData);
      toast.success('Event created successfully');
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
          options={typeOptions}
          error={errors.type?.message}
          {...register('type')}
        />
        <Input
          label="Location"
          required
          error={errors.location?.message}
          {...register('location')}
        />
      </div>
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
        <label className="block text-sm font-medium text-neutral-700 mb-2">
          Participating Schools
        </label>
        <div className="border border-neutral-200 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
          {[...state.schools]
            .filter((s) => s.isActive)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((school) => (
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
                <span className="text-xs text-neutral-400">({school.county})</span>
              </label>
            ))}
        </div>
        {selectedSchools && selectedSchools.length > 0 && (
          <p className="mt-1 text-xs text-neutral-400">
            {selectedSchools.length} school{selectedSchools.length !== 1 ? 's' : ''} selected
          </p>
        )}
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
