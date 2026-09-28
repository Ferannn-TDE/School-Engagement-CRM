import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Clock, MapPin, School } from 'lucide-react';
import type { Event } from '../../types';
import { EventTypeLabels } from '../../types';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { useAppContext } from '../../context/AppContext';

/** Everything about an event at a glance: shown in a pop-up when an event is clicked. */
export function EventDetails({ event, onEdit }: { event: Event; onEdit?: () => void }) {
  const { getSchoolById } = useAppContext();
  const when = new Date(event.date);
  const schools = event.participatingSchools.map((id) => ({ id, school: getSchoolById(id) }));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-neutral-800">{event.name}</p>
        <div className="mt-1">
          <Badge variant="info">{EventTypeLabels[event.type]}</Badge>
        </div>
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
          <dt className="sr-only">Schools involved</dt>
          <School size={16} className="text-neutral-400 mt-0.5 shrink-0" aria-hidden="true" />
          <dd className="min-w-0">
            {schools.length === 0 ? (
              <span className="text-neutral-400">No schools listed</span>
            ) : (
              <ul className="space-y-1">
                {schools.map(({ id, school }) => (
                  <li key={id}>
                    {school ? (
                      <Link
                        to={`/schools/${encodeURIComponent(id)}`}
                        className="text-neutral-800 hover:text-siue-red"
                      >
                        {school.name}
                        <span className="text-neutral-400">
                          {' '}· {school.city}, {school.state}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-neutral-500">Unknown school ({id})</span>
                    )}
                  </li>
                ))}
              </ul>
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
