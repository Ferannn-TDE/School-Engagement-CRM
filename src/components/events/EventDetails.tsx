import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Clock, MapPin, School } from 'lucide-react';
import type { Event } from '../../types';
import { eventSchoolIds, eventSourceLabel } from '../../utils/events';
import { eventTypeLabel } from '../../utils/labels';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/useAppContext';

/** One school on an event: its name and place, linked to its page. */
function SchoolLine({ id }: { id: string }) {
  const { getSchoolById } = useAppContext();
  const school = getSchoolById(id);
  return school ? (
    <Link to={`/schools/${encodeURIComponent(id)}`} className="text-neutral-800 hover:text-siue-red">
      {school.name}
      <span className="text-neutral-400">{' '}· {school.city}, {school.state}</span>
    </Link>
  ) : (
    <span className="text-neutral-500">Unknown school ({id})</span>
  );
}

/** Everything about an event at a glance: shown in a pop-up when an event is clicked. */
export function EventDetails({ event, onEdit }: { event: Event; onEdit?: () => void }) {
  const when = new Date(event.date);
  // eventSchoolIds is the one rule for an event's schools: host plus participants, each once.
  const all = eventSchoolIds(event);
  const participants = all.filter((id) => id !== event.hostSchoolId);
  const total = all.length;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-neutral-800">{event.name}</p>
        {/* Source as before; Type is the one chosen in the event form (db/028), "Not set" until then. */}
        <p className="mt-0.5 text-sm text-neutral-500">{eventSourceLabel(event)} · Type: {eventTypeLabel(event)}</p>
      </div>

      <dl className="space-y-3 text-sm">
        <div className="flex items-start gap-3">
          <dt className="sr-only">Date</dt>
          <Calendar size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className="text-neutral-800">{format(when, 'EEEE, MMMM d, yyyy')}</dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="sr-only">Time</dt>
          <Clock size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className={event.hasTime ? 'text-neutral-800' : 'text-neutral-500'}>
            {event.hasTime ? `${format(when, 'h:mm a')} Central` : 'All day, or no time given'}
          </dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="sr-only">Location</dt>
          <MapPin size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className={event.location ? 'text-neutral-800 break-words' : 'text-neutral-400'}>
            {event.location || 'No location given'}
          </dd>
        </div>
        <div className="flex items-start gap-3">
          <dt className="sr-only">Schools</dt>
          <School size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className="min-w-0 space-y-2">
            {total === 0 && <span className="text-neutral-400">No schools listed</span>}
            {/* The school whose calendar listed the event (events.schools_involved). */}
            {event.hostSchoolId && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Host school</p>
                <SchoolLine id={event.hostSchoolId} />
              </div>
            )}
            {participants.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Participating schools ({participants.length})
                </p>
                <ul className="space-y-1">
                  {participants.map((id) => <li key={id}><SchoolLine id={id} /></li>)}
                </ul>
              </div>
            )}
            {event.hostSchoolId && participants.length > 0 && (
              <p className="text-xs text-neutral-500">{total} schools in all</p>
            )}
          </dd>
        </div>
      </dl>

      {onEdit && (
        <div className="flex justify-end pt-3 border-t border-neutral-100">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            Edit event
          </Button>
        </div>
      )}
    </div>
  );
}
