import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Calendar, CalendarDays, List, MapPin, Users } from 'lucide-react';
import { format, isAfter, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { EventForm } from '../components/events/EventForm';
import { useAppContext } from '../context/AppContext';
import type { Event } from '../types';
import { EventType, EventTypeLabels } from '../types';
import { classNames } from '../utils/helpers';
import toast from 'react-hot-toast';

export function EventsPage() {
  const { state, deleteEvent } = useAppContext();
  const [view, setView] = useState<'calendar' | 'list'>('list');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<Event | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  const filteredEvents = useMemo(() => {
    let events = state.events;
    if (typeFilter) events = events.filter((e) => e.type === typeFilter);
    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [state.events, typeFilter]);

  const typeOptions = Object.values(EventType).map((type) => ({
    value: type,
    label: EventTypeLabels[type],
  }));

  const columns: ColumnDef<Event, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Event Name',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-neutral-800">{row.original.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-neutral-400 flex items-center gap-1">
                <MapPin size={12} />
                {row.original.location}
              </span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ getValue }) => (
          <Badge variant="info">{EventTypeLabels[getValue() as EventType]}</Badge>
        ),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => {
          const isPast = !isAfter(new Date(row.original.date), new Date());
          return (
            <div>
              <span className={classNames('text-sm', isPast ? 'text-neutral-400' : 'text-neutral-700')}>
                {format(new Date(row.original.date), 'MMM d, yyyy')}
              </span>
              {isPast && <Badge variant="default" className="ml-2">Past</Badge>}
            </div>
          );
        },
      },
      {
        id: 'schools',
        header: 'Schools',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Users size={14} className="text-neutral-400" />
            <span>{row.original.participatingSchools.length}</span>
          </div>
        ),
      },
      {
        accessorKey: 'attendeeCount',
        header: 'Attendees',
        cell: ({ getValue }) => {
          const count = getValue() as number | undefined;
          return count ? count : <span className="text-neutral-300">-</span>;
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setEditingEvent(row.original)}
              className="text-xs text-info hover:underline"
            >
              Edit
            </button>
            <span className="text-neutral-200">|</span>
            <button
              onClick={() => setDeletingEvent(row.original)}
              className="text-xs text-error hover:underline"
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    []
  );

  // Calendar view helpers
  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPadding = getDay(monthStart);

  const eventsInMonth = useMemo(
    () =>
      state.events.filter((e) => isSameMonth(new Date(e.date), calendarMonth)),
    [state.events, calendarMonth]
  );

  return (
    <div>
      <Header
        title="Events"
        subtitle={`${state.events.length} events`}
        actions={
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
              <button
                onClick={() => setView('list')}
                className={classNames(
                  'px-3 py-1.5 text-sm',
                  view === 'list' ? 'bg-siue-red text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                )}
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setView('calendar')}
                className={classNames(
                  'px-3 py-1.5 text-sm',
                  view === 'calendar' ? 'bg-siue-red text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                )}
              >
                <CalendarDays size={16} />
              </button>
            </div>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              Create Event
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        {view === 'list' ? (
          <>
            <Card>
              <div className="flex gap-4">
                <Select
                  options={typeOptions}
                  placeholder="All Types"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-48"
                />
                {typeFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setTypeFilter('')}>
                    Clear
                  </Button>
                )}
              </div>
            </Card>
            {state.events.length === 0 ? (
              <EmptyState
                icon={<Calendar size={32} />}
                title="No events yet"
                description="Create your first event to start tracking engagement activities."
                action={
                  <Button onClick={() => setShowAddModal(true)}>
                    <Plus size={16} />
                    Create Event
                  </Button>
                }
              />
            ) : (
              <Card padding={false}>
                <DataTable
                  data={filteredEvents}
                  columns={columns}
                  emptyMessage="No events match your filter."
                />
              </Card>
            )}
          </>
        ) : (
          /* Calendar View */
          <Card>
            <div className="flex items-center justify-between mb-6">
              <Button variant="ghost" size="sm" onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))}>
                Previous
              </Button>
              <h3 className="text-lg font-semibold text-neutral-800">
                {format(calendarMonth, 'MMMM yyyy')}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}>
                Next
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-px bg-neutral-100 rounded-lg overflow-hidden">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="bg-neutral-50 p-2 text-center text-xs font-semibold text-neutral-500">
                  {day}
                </div>
              ))}
              {Array.from({ length: startPadding }).map((_, i) => (
                <div key={`pad-${i}`} className="bg-white p-2 min-h-[100px]" />
              ))}
              {calendarDays.map((day) => {
                const dayEvents = eventsInMonth.filter(
                  (e) => format(new Date(e.date), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
                );
                return (
                  <div key={day.toISOString()} className="bg-white p-2 min-h-[100px]">
                    <span className="text-sm text-neutral-500">{format(day, 'd')}</span>
                    {dayEvents.map((event) => (
                      <div
                        key={event.id}
                        className="mt-1 px-1.5 py-0.5 bg-siue-red/10 text-siue-red text-xs rounded truncate cursor-pointer hover:bg-siue-red/20"
                        title={event.name}
                        onClick={() => setEditingEvent(event)}
                      >
                        {event.name}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create Event" size="lg">
        <EventForm onClose={() => setShowAddModal(false)} />
      </Modal>

      <Modal open={!!editingEvent} onClose={() => setEditingEvent(null)} title="Edit Event" size="lg">
        {editingEvent && <EventForm event={editingEvent} onClose={() => setEditingEvent(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deletingEvent}
        onClose={() => setDeletingEvent(null)}
        onConfirm={() => {
          if (deletingEvent) {
            deleteEvent(deletingEvent.id);
            toast.success('Event deleted');
          }
        }}
        title="Delete Event"
        message={deletingEvent ? `Delete "${deletingEvent.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete Event"
      />
    </div>
  );
}
