import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import type { School, Contact, Event, ActivityRecord, Program } from '../types';
import { nowISO } from '../utils/helpers';
import {
  fetchSchools,
  createSchool,
  createSchoolsBulk,
  updateSchool as dbUpdateSchool,
  deleteSchool as dbDeleteSchool,
  markSchoolVerified,
  markSchoolsVerifiedBulk,
} from '../services/schoolsService';
import {
  fetchContacts,
  createContact,
  createContactsBulk,
  updateContact as dbUpdateContact,
  deleteContact as dbDeleteContact,
  markContactVerified,
} from '../services/contactsService';
import {
  fetchEvents,
  createEvent,
  updateEvent as dbUpdateEvent,
  deleteEvent as dbDeleteEvent,
} from '../services/eventsService';
import {
  fetchActivities,
  createActivity,
  deleteActivity as dbDeleteActivity,
} from '../services/activitiesService';
import {
  fetchPrograms,
  createProgram,
  updateProgram as dbUpdateProgram,
  deleteProgram as dbDeleteProgram,
} from '../services/programsService';

interface AppState {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
  programs: Program[];
}

type Action =
  | { type: 'SET_SCHOOLS'; payload: School[] }
  | { type: 'ADD_SCHOOL'; payload: School }
  | { type: 'ADD_SCHOOLS_BULK'; payload: School[] }
  | { type: 'UPDATE_SCHOOL'; payload: School }
  | { type: 'DELETE_SCHOOL'; payload: string }
  | { type: 'DELETE_CONTACTS_BY_SCHOOL'; payload: string }
  | { type: 'SET_CONTACTS'; payload: Contact[] }
  | { type: 'ADD_CONTACT'; payload: Contact }
  | { type: 'ADD_CONTACTS_BULK'; payload: Contact[] }
  | { type: 'UPDATE_CONTACT'; payload: Contact }
  | { type: 'DELETE_CONTACT'; payload: string }
  | { type: 'SET_EVENTS'; payload: Event[] }
  | { type: 'ADD_EVENT'; payload: Event }
  | { type: 'UPDATE_EVENT'; payload: Event }
  | { type: 'DELETE_EVENT'; payload: string }
  | { type: 'SET_ACTIVITIES'; payload: ActivityRecord[] }
  | { type: 'ADD_ACTIVITY'; payload: ActivityRecord }
  | { type: 'DELETE_ACTIVITY'; payload: string }
  | { type: 'SET_PROGRAMS'; payload: Program[] }
  | { type: 'ADD_PROGRAM'; payload: Program }
  | { type: 'UPDATE_PROGRAM'; payload: Program }
  | { type: 'DELETE_PROGRAM'; payload: string }
  | { type: 'VERIFY_SCHOOLS_BULK'; payload: { ids: string[]; now: string } }
  | { type: 'VERIFY_CONTACT'; payload: { id: string; now: string } }
  | { type: 'LOAD_STATE'; payload: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload;
    case 'SET_SCHOOLS':
      return { ...state, schools: action.payload };
    case 'ADD_SCHOOL':
      return { ...state, schools: [...state.schools, action.payload] };
    case 'ADD_SCHOOLS_BULK':
      return { ...state, schools: [...state.schools, ...action.payload] };
    case 'UPDATE_SCHOOL':
      return {
        ...state,
        schools: state.schools.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'DELETE_SCHOOL':
      return {
        ...state,
        schools: state.schools.filter((s) => s.id !== action.payload),
      };
    case 'DELETE_CONTACTS_BY_SCHOOL':
      return {
        ...state,
        contacts: state.contacts.filter((c) => c.schoolId !== action.payload),
      };
    case 'SET_CONTACTS':
      return { ...state, contacts: action.payload };
    case 'ADD_CONTACT':
      return { ...state, contacts: [...state.contacts, action.payload] };
    case 'ADD_CONTACTS_BULK':
      return { ...state, contacts: [...state.contacts, ...action.payload] };
    case 'UPDATE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case 'DELETE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.filter((c) => c.id !== action.payload),
      };
    case 'SET_EVENTS':
      return { ...state, events: action.payload };
    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.payload] };
    case 'UPDATE_EVENT':
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.payload.id ? action.payload : e
        ),
      };
    case 'DELETE_EVENT':
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.payload),
      };
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.payload };
    case 'ADD_ACTIVITY':
      return { ...state, activities: [...state.activities, action.payload] };
    case 'DELETE_ACTIVITY':
      return {
        ...state,
        activities: state.activities.filter((a) => a.id !== action.payload),
      };
    case 'SET_PROGRAMS':
      return { ...state, programs: action.payload };
    case 'ADD_PROGRAM':
      return { ...state, programs: [...state.programs, action.payload] };
    case 'UPDATE_PROGRAM':
      return {
        ...state,
        programs: state.programs.map((p) =>
          p.id === action.payload.id ? action.payload : p
        ),
      };
    case 'DELETE_PROGRAM':
      return {
        ...state,
        programs: state.programs.filter((p) => p.id !== action.payload),
      };
    case 'VERIFY_SCHOOLS_BULK':
      return {
        ...state,
        schools: state.schools.map((s) =>
          action.payload.ids.includes(s.id)
            ? { ...s, isVerified: true, lastVerifiedAt: action.payload.now, updatedAt: action.payload.now }
            : s
        ),
      };
    case 'VERIFY_CONTACT':
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === action.payload.id
            ? { ...c, isVerified: true, lastVerifiedAt: action.payload.now, updatedAt: action.payload.now }
            : c
        ),
      };
    default:
      return state;
  }
}

const initialState: AppState = {
  schools: [],
  contacts: [],
  events: [],
  activities: [],
  programs: [],
};

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  loading: boolean;
  error: string | null;
  addSchool: (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addSchoolsBulk: (schools: Omit<School, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<School[]>;
  updateSchool: (school: School) => void;
  deleteSchool: (id: string) => void;
  addContact: (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addContactsBulk: (contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
  updateContact: (contact: Contact) => void;
  deleteContact: (id: string) => void;
  addEvent: (event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateEvent: (event: Event) => void;
  deleteEvent: (id: string) => void;
  addActivity: (activity: Omit<ActivityRecord, 'id'>) => void;
  deleteActivity: (id: string) => void;
  addProgram: (program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProgram: (program: Program) => void;
  deleteProgram: (id: string) => void;
  verifySchool: (id: string) => void;
  verifySchoolsBulk: (ids: string[]) => void;
  verifyContact: (id: string) => void;
  getSchoolById: (id: string) => School | undefined;
  getContactsBySchool: (schoolId: string) => Contact[];
  getActivitiesBySchool: (schoolId: string) => ActivityRecord[];
  getEventsBySchool: (schoolId: string) => Event[];
  getProgramsBySchool: (schoolId: string) => Program[];
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all data from Supabase on mount (activities from localStorage)
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [schools, contacts, events, activities, programs] = await Promise.all([
          fetchSchools(),
          fetchContacts(),
          fetchEvents(),
          fetchActivities(),
          fetchPrograms(),
        ]);
        dispatch({
          type: 'LOAD_STATE',
          payload: { schools, contacts, events, activities, programs },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data from database';
        setError(message);
        console.error('AppContext load error:', err);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  // Schools
  const addSchool = (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createSchool(school)
      .then((created) => dispatch({ type: 'ADD_SCHOOL', payload: created }))
      .catch((err) => {
        console.error('addSchool failed:', err);
        toast.error('Failed to save school');
      });
  };

  const addSchoolsBulk = async (
    schools: Omit<School, 'id' | 'createdAt' | 'updatedAt'>[]
  ): Promise<School[]> => {
    const created = await createSchoolsBulk(schools);
    dispatch({ type: 'ADD_SCHOOLS_BULK', payload: created });
    return created;
  };

  const updateSchool = (school: School): void => {
    dbUpdateSchool(school.id, school)
      .then(() =>
        dispatch({
          type: 'UPDATE_SCHOOL',
          payload: { ...school, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateSchool failed:', err);
        toast.error('Failed to update school');
      });
  };

  const deleteSchool = (id: string): void => {
    dbDeleteSchool(id)
      .then(() => {
        dispatch({ type: 'DELETE_CONTACTS_BY_SCHOOL', payload: id });
        dispatch({ type: 'DELETE_SCHOOL', payload: id });
      })
      .catch((err) => {
        console.error('deleteSchool failed:', err);
        toast.error('Failed to delete school');
      });
  };

  // Contacts
  const addContact = (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createContact(contact)
      .then((created) => dispatch({ type: 'ADD_CONTACT', payload: created }))
      .catch((err) => {
        console.error('addContact failed:', err);
        toast.error('Failed to save contact');
      });
  };

  const addContactsBulk = (
    contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]
  ): void => {
    createContactsBulk(contacts)
      .then((created) => dispatch({ type: 'ADD_CONTACTS_BULK', payload: created }))
      .catch((err) => {
        console.error('addContactsBulk failed:', err);
        toast.error('Failed to import contacts');
      });
  };

  const updateContact = (contact: Contact): void => {
    dbUpdateContact(contact.id, contact)
      .then(() =>
        dispatch({
          type: 'UPDATE_CONTACT',
          payload: { ...contact, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateContact failed:', err);
        toast.error('Failed to update contact');
      });
  };

  const deleteContact = (id: string): void => {
    dbDeleteContact(id)
      .then(() => dispatch({ type: 'DELETE_CONTACT', payload: id }))
      .catch((err) => {
        console.error('deleteContact failed:', err);
        toast.error('Failed to delete contact');
      });
  };

  // Events
  const addEvent = (event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createEvent(event)
      .then((created) => dispatch({ type: 'ADD_EVENT', payload: created }))
      .catch((err) => {
        console.error('addEvent failed:', err);
        toast.error('Failed to save event');
      });
  };

  const updateEvent = (event: Event): void => {
    dbUpdateEvent(event.id, event)
      .then(() =>
        dispatch({
          type: 'UPDATE_EVENT',
          payload: { ...event, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateEvent failed:', err);
        toast.error('Failed to update event');
      });
  };

  const deleteEvent = (id: string): void => {
    dbDeleteEvent(id)
      .then(() => dispatch({ type: 'DELETE_EVENT', payload: id }))
      .catch((err) => {
        console.error('deleteEvent failed:', err);
        toast.error('Failed to delete event');
      });
  };

  // Activities (Supabase-backed)
  const addActivity = (activity: Omit<ActivityRecord, 'id'>): void => {
    createActivity(activity)
      .then((created) => dispatch({ type: 'ADD_ACTIVITY', payload: created }))
      .catch((err) => {
        console.error('addActivity failed:', err);
        toast.error('Failed to save activity');
      });
  };

  const deleteActivity = (id: string): void => {
    dbDeleteActivity(id)
      .then(() => dispatch({ type: 'DELETE_ACTIVITY', payload: id }))
      .catch((err) => {
        console.error('deleteActivity failed:', err);
        toast.error('Failed to delete activity');
      });
  };

  // Programs
  const addProgram = (program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createProgram(program)
      .then((created) => dispatch({ type: 'ADD_PROGRAM', payload: created }))
      .catch((err) => {
        console.error('addProgram failed:', err);
        toast.error('Failed to save program');
      });
  };

  const updateProgram = (program: Program): void => {
    dbUpdateProgram(program.id, program)
      .then(() => dispatch({ type: 'UPDATE_PROGRAM', payload: { ...program, updatedAt: nowISO() } }))
      .catch((err) => {
        console.error('updateProgram failed:', err);
        toast.error('Failed to update program');
      });
  };

  const deleteProgram = (id: string): void => {
    dbDeleteProgram(id)
      .then(() => dispatch({ type: 'DELETE_PROGRAM', payload: id }))
      .catch((err) => {
        console.error('deleteProgram failed:', err);
        toast.error('Failed to delete program');
      });
  };

  const verifySchool = (id: string): void => {
    markSchoolVerified(id)
      .then(() => {
        const now = new Date().toISOString();
        dispatch({ type: 'VERIFY_SCHOOLS_BULK', payload: { ids: [id], now } });
        toast.success('School marked as verified');
      })
      .catch((err) => {
        console.error('verifySchool failed:', err);
        toast.error('Failed to verify school');
      });
  };

  const verifySchoolsBulk = (ids: string[]): void => {
    if (ids.length === 0) return;
    markSchoolsVerifiedBulk(ids)
      .then(() => {
        const now = new Date().toISOString();
        dispatch({ type: 'VERIFY_SCHOOLS_BULK', payload: { ids, now } });
        toast.success(`${ids.length} school${ids.length !== 1 ? 's' : ''} marked as verified`);
      })
      .catch((err) => {
        console.error('verifySchoolsBulk failed:', err);
        toast.error('Failed to bulk verify schools');
      });
  };

  const verifyContact = (id: string): void => {
    markContactVerified(id)
      .then(() => {
        const now = new Date().toISOString();
        dispatch({ type: 'VERIFY_CONTACT', payload: { id, now } });
        toast.success('Contact marked as verified');
      })
      .catch((err) => {
        console.error('verifyContact failed:', err);
        toast.error('Failed to verify contact');
      });
  };

  // Selectors — memoized so consumers don't re-render on unrelated state changes
  const getSchoolById = useCallback(
    (id: string) => state.schools.find((s) => s.id === id),
    [state.schools]
  );
  const getContactsBySchool = useCallback(
    (schoolId: string) => state.contacts.filter((c) => c.schoolId === schoolId),
    [state.contacts]
  );
  const getActivitiesBySchool = useCallback(
    (schoolId: string) => state.activities.filter((a) => a.schoolId === schoolId),
    [state.activities]
  );
  const getEventsBySchool = useCallback(
    (schoolId: string) => state.events.filter((e) => e.participatingSchools.includes(schoolId)),
    [state.events]
  );
  const getProgramsBySchool = useCallback(
    (schoolId: string) => state.programs.filter((p) => p.schoolId === schoolId),
    [state.programs]
  );

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        loading,
        error,
        addSchool,
        addSchoolsBulk,
        updateSchool,
        deleteSchool,
        addContact,
        addContactsBulk,
        updateContact,
        deleteContact,
        addEvent,
        updateEvent,
        deleteEvent,
        addActivity,
        deleteActivity,
        addProgram,
        updateProgram,
        deleteProgram,
        verifySchool,
        verifySchoolsBulk,
        verifyContact,
        getSchoolById,
        getContactsBySchool,
        getActivitiesBySchool,
        getEventsBySchool,
        getProgramsBySchool,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
