import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Calendar, CalendarDays, CalendarX, List, MapPin, Users } from 'lucide-react';
import { format, isAfter, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isToday } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FilterBar } from '../components/common/FilterBar';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { EventForm } from '../components/events/EventForm';
import { EventDetails } from '../components/events/EventDetails';
import { useAppContext } from '../context/AppContext';
import { useUrlState } from '../hooks/useUrlState';
import type { Event } from '../types';
import { EventType, EventTypeLabels } from '../types';
import { classNames } from '../utils/helpers';
import { isTestingDate } from '../utils/events';
import toast from 'react-hot-toast';

export function EventsPage() {
  const { state, deleteEvent } = useAppContext();
  // Kept in the address so the view survives leaving the tab, a refresh and Back.
  const [viewRaw, setView] = useUrlState('view', 'list');
  const view: 'calendar' | 'list' = viewRaw === 'calendar' ? 'calendar' : 'list';
  const [typeFilter, setTypeFilter] = useUrlState('type');
  // SAT/ACT/PSAT/AP exam days (db/007) are busy dates, not outreach: hidden unless asked for.
  const [testingRaw, setTestingRaw] = useUrlState('testing');
  const showTesting = testingRaw === '1';
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [viewingEvent, setViewingEvent] = useState<Event | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<Event | null>(null);
  const [monthRaw, setMonthRaw] = useUrlState('month');
  const calendarMonth = useMemo(() => {
    const parsed = /^\d{4}-\d{2}$/.test(monthRaw) ? new Date(`${monthRaw}-01T12:00:00`) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  }, [monthRaw]);
  const setCalendarMonth = (d: Date) => setMonthRaw(format(d, 'yyyy-MM'));

  const visibleEvents = useMemo(
    () => (showTesting ? state.events : state.events.filter((e) => !isTestingDate(e))),
    [state.events, showTesting]
  );
  const testingCount = useMemo(() => state.events.filter(isTestingDate).length, [state.events]);
  const outreachCount = state.events.length - testingCount;

  const filteredEvents = useMemo(() => {
    let events = visibleEvents;
    if (typeFilter) events = events.filter((e) => e.type === typeFilter);
    return [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [visibleEvents, typeFilter]);

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
            <p className={classNames('font-medium', isTestingDate(row.original) ? 'text-neutral-500' : 'text-neutral-800')}>
              {row.original.name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-neutral-500 flex items-center gap-1">
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
        cell: ({ row, getValue }) =>
          isTestingDate(row.original) ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border border-dashed border-neutral-400 text-neutral-600">
              <CalendarX size={12} />
              Testing date
            </span>
          ) : (
            <Badge variant="info">{EventTypeLabels[getValue() as EventType]}</Badge>
          ),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => {
          const isPast = !isAfter(new Date(row.original.date), new Date());
          return (
            <div className="flex items-center gap-2">
              <span className={classNames('text-sm', isPast ? 'text-neutral-400' : 'text-neutral-700')}>
                {format(new Date(row.original.date), 'MMM d, yyyy')}
              </span>
              {isPast && <Badge variant="default">Past</Badge>}
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
          return count ?? 0;
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
      visibleEvents.filter((e) => isSameMonth(new Date(e.date), calendarMonth)),
    [visibleEvents, calendarMonth]
  );

  return (
    <div>
<Header
        title="Events"
        subtitle={
          showTesting
            ? `${outreachCount} events · ${testingCount} testing dates shown`
            : `${outreachCount} events`
        }
        actions={
          <div className="flex gap-2">
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-600 border border-neutral-200 rounded-lg bg-white cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showTesting}
                onChange={(e) => setTestingRaw(e.target.checked ? '1' : '')}
                className="accent-siue-red"
              />
              Show testing dates
            </label>
            <div className="flex rounded-lg border border-neutral-200 overflow-hidden">
              <button
                onClick={() => setView('list')}
                aria-label="List view"
                title="List view"
                aria-pressed={view === 'list'}
                className={classNames(
                  'px-3 py-1.5 text-sm',
                  view === 'list' ? 'bg-siue-red text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                )}
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setView('calendar')}
                aria-label="Calendar view"
                title="Calendar view"
                aria-pressed={view === 'calendar'}
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
            <FilterBar
              filters={[
                { value: typeFilter, onChange: setTypeFilter, options: typeOptions, placeholder: 'All Types', className: 'w-48' },
              ]}
              onClear={() => setTypeFilter('')}
            />
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
                  columnWidths={['32%', '15%', '18%', '10%', '10%', '15%']}
                  urlState
                  resetKey={`${typeFilter}|${showTesting}`}
                  onRowClick={(event) => setViewingEvent(event)}
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
                const today = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={classNames(
                      'p-2 min-h-[100px]',
                      today ? 'bg-blue-50 ring-2 ring-inset ring-blue-200' : 'bg-white'
                    )}
                  >
                    <span
                      className={classNames(
                        'text-sm leading-none',
                        today ? 'font-bold text-blue-600' : 'text-neutral-500'
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    {today && (
                      <span className="block text-xs text-blue-400 leading-none mt-0.5">Today</span>
                    )}
                    {dayEvents.map((event) => (
                      <div
                        key={event.id}
                        className={classNames(
                          'mt-1 px-1.5 py-0.5 text-xs rounded truncate cursor-pointer',
                          isTestingDate(event)
                            ? 'border border-dashed border-neutral-400 text-neutral-500 bg-neutral-50 hover:bg-neutral-100'
                            : 'bg-siue-red/10 text-siue-red hover:bg-siue-red/20'
                        )}
                        title={isTestingDate(event) ? `Testing date: ${event.name}` : event.name}
                        onClick={() => setViewingEvent(event)}
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

      <Modal open={!!viewingEvent} onClose={() => setViewingEvent(null)} title="Event" size="md">
        {viewingEvent && (
          <EventDetails
            event={viewingEvent}
            onEdit={() => {
              setEditingEvent(viewingEvent);
              setViewingEvent(null);
            }}
          />
        )}
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
