import {
  useCallback,
  useReducer,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import { writeErrorMessage } from '../utils/writeErrors';
import { AppContext, useAppContext } from './useAppContext';
import type { School, Contact, Event, ActivityRecord, Program } from '../types';
import { nowISO } from '../utils/helpers';
import {
  fetchSchools,
  createSchool,
  createSchoolsBulk,
  updateSchool as dbUpdateSchool,
  archiveSchool as dbArchiveSchool,
  markSchoolVerified,
  markSchoolsVerifiedBulk,
} from '../services/schoolsService';
import {
  fetchContacts,
  createContact,
  createContactsBulk,
  updateContact as dbUpdateContact,
  archiveContact as dbArchiveContact,
  markContactVerified,
} from '../services/contactsService';
import {
  fetchEvents,
  createEvent,
  updateEvent as dbUpdateEvent,
  archiveEvent as dbArchiveEvent,
} from '../services/eventsService';
import {
  fetchActivities,
  createActivity,
  archiveActivity as dbArchiveActivity,
} from '../services/activitiesService';
import {
  fetchPrograms,
  createProgram,
  updateProgram as dbUpdateProgram,
  archiveProgram as dbArchiveProgram,
} from '../services/programsService';

export interface AppState {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
  programs: Program[];
}

/** One of the five tables loaded at startup. */
export type DataTable = keyof AppState;

/** The tables that failed to load, with the error for each. */
export type LoadErrors = Partial<Record<DataTable, string>>;

type Action =
  | { type: 'SET_SCHOOLS'; payload: School[] }
  | { type: 'ADD_SCHOOL'; payload: School }
  | { type: 'ADD_SCHOOLS_BULK'; payload: School[] }
  | { type: 'UPDATE_SCHOOL'; payload: School }
  | { type: 'ARCHIVE_SCHOOL'; payload: string }
  | { type: 'ARCHIVE_CONTACTS_BY_SCHOOL'; payload: string }
  | { type: 'SET_CONTACTS'; payload: Contact[] }
  | { type: 'ADD_CONTACT'; payload: Contact }
  | { type: 'ADD_CONTACTS_BULK'; payload: Contact[] }
  | { type: 'UPDATE_CONTACT'; payload: Contact }
  | { type: 'ARCHIVE_CONTACT'; payload: string }
  | { type: 'SET_EVENTS'; payload: Event[] }
  | { type: 'ADD_EVENT'; payload: Event }
  | { type: 'UPDATE_EVENT'; payload: Event }
  | { type: 'ARCHIVE_EVENT'; payload: string }
  | { type: 'SET_ACTIVITIES'; payload: ActivityRecord[] }
  | { type: 'ADD_ACTIVITY'; payload: ActivityRecord }
  | { type: 'ARCHIVE_ACTIVITY'; payload: string }
  | { type: 'SET_PROGRAMS'; payload: Program[] }
  | { type: 'ADD_PROGRAM'; payload: Program }
  | { type: 'UPDATE_PROGRAM'; payload: Program }
  | { type: 'ARCHIVE_PROGRAM'; payload: string }
  | { type: 'VERIFY_SCHOOLS_BULK'; payload: { ids: string[]; now: string } }
  | { type: 'VERIFY_CONTACT'; payload: { id: string; now: string } }
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'LOAD_PARTIAL'; payload: Partial<AppState> };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload;
    case 'LOAD_PARTIAL':
      return { ...state, ...action.payload };
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
    case 'ARCHIVE_SCHOOL':
      return {
        ...state,
        schools: state.schools.filter((s) => s.id !== action.payload),
      };
    case 'ARCHIVE_CONTACTS_BY_SCHOOL':
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
    case 'ARCHIVE_CONTACT':
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
    case 'ARCHIVE_EVENT':
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.payload),
      };
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.payload };
    case 'ADD_ACTIVITY':
      return { ...state, activities: [...state.activities, action.payload] };
    case 'ARCHIVE_ACTIVITY':
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
    case 'ARCHIVE_PROGRAM':
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

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  loading: boolean;
  /** Tables whose startup load failed. Pages that need one of them show a retry message. */
  loadErrors: LoadErrors;
  addSchool: (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addSchoolsBulk: (schools: Omit<School, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<School[]>;
  /** `changes` limits the database write to those fields; without it every field is written. */
  updateSchool: (school: School, changes?: Partial<School>) => void;
  /** Archives, never deletes (db/009): hidden everywhere, restorable in Settings → Archived. */
  archiveSchool: (id: string) => void;
  addContact: (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addContactsBulk: (contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
  /** `changes` limits the database write to those fields; without it every field is written. */
  updateContact: (contact: Contact, changes?: Partial<Contact>) => void;
  archiveContact: (id: string) => void;
  addEvent: (event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>) => void;
  /** `changes` limits the database write to those fields; without it every field is written. */
  updateEvent: (event: Event, changes?: Partial<Event>) => void;
  archiveEvent: (id: string) => void;
  /** Resolves once saved; rejects on failure so the caller can keep the form open. */
  addActivity: (activity: Omit<ActivityRecord, 'id'>) => Promise<void>;
  archiveActivity: (id: string) => void;
  addProgram: (program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProgram: (program: Program) => void;
  archiveProgram: (id: string) => void;
  verifySchool: (id: string) => void;
  verifySchoolsBulk: (ids: string[]) => void;
  verifyContact: (id: string) => void;
  getSchoolById: (id: string) => School | undefined;
  getContactsBySchool: (schoolId: string) => Contact[];
  getActivitiesBySchool: (schoolId: string) => ActivityRecord[];
  getEventsBySchool: (schoolId: string) => Event[];
  getProgramsBySchool: (schoolId: string) => Program[];
  /** Fetches everything again, e.g. after restoring archived items. */
  reload: () => Promise<void>;
}

interface StartupLoad {
  loaded: Partial<AppState>;
  errors: LoadErrors;
}

/** Fetches the five tables independently; never rejects. */
async function loadStartupTables(): Promise<StartupLoad> {
  const tables: DataTable[] = ['schools', 'contacts', 'events', 'activities', 'programs'];
  const results = await Promise.allSettled([
    fetchSchools(),
    fetchContacts(),
    fetchEvents(),
    fetchActivities(),
    fetchPrograms(),
  ]);
  const loaded: Partial<AppState> = {};
  const errors: LoadErrors = {};
  results.forEach((result, i) => {
    const table = tables[i];
    if (result.status === 'fulfilled') {
      (loaded as Record<DataTable, unknown>)[table] = result.value;
    } else {
      const err: unknown = result.reason;
      // Supabase errors are plain objects with a message, not always Error instances.
      const message = (err as { message?: unknown } | null)?.message;
      errors[table] = typeof message === 'string' && message ? message : String(err);
      console.error(`AppContext load error (${table}):`, err);
    }
  });
  return { loaded, errors };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({});

  // Load all data from Supabase on mount, and again after a restore (reload).
  // Each table loads on its own: one failure keeps the others, and only the pages
  // that need the failed table are paused (AppLayout).
  const applyLoad = useCallback(({ loaded, errors }: StartupLoad) => {
    dispatch({ type: 'LOAD_PARTIAL', payload: loaded });
    setLoadErrors(errors);
    setLoading(false);
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    applyLoad(await loadStartupTables());
  }, [applyLoad]);
  // `loading` starts true, so the first load only has to apply the result.
  useEffect(() => {
    void loadStartupTables().then(applyLoad);
  }, [applyLoad]);

  // Schools
  const addSchool = (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createSchool(school)
      .then((created) => dispatch({ type: 'ADD_SCHOOL', payload: created }))
      .catch((err) => {
        console.error('addSchool failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to save school'));
      });
  };

  const addSchoolsBulk = async (
    schools: Omit<School, 'id' | 'createdAt' | 'updatedAt'>[]
  ): Promise<School[]> => {
    const created = await createSchoolsBulk(schools);
    dispatch({ type: 'ADD_SCHOOLS_BULK', payload: created });
    return created;
  };

  const updateSchool = (school: School, changes?: Partial<School>): void => {
    dbUpdateSchool(school.id, changes ?? school)
      .then(() =>
        dispatch({
          type: 'UPDATE_SCHOOL',
          payload: { ...school, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateSchool failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to update school'));
      });
  };

  const archiveSchool = (id: string): void => {
    dbArchiveSchool(id)
      .then(() => {
        dispatch({ type: 'ARCHIVE_CONTACTS_BY_SCHOOL', payload: id });
        dispatch({ type: 'ARCHIVE_SCHOOL', payload: id });
      })
      .catch((err) => {
        console.error('archiveSchool failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to archive school'));
      });
  };

  // Contacts
  const addContact = (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createContact(contact)
      .then((created) => dispatch({ type: 'ADD_CONTACT', payload: created }))
      .catch((err) => {
        console.error('addContact failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to save contact'));
      });
  };

  const addContactsBulk = (
    contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]
  ): void => {
    createContactsBulk(contacts)
      .then((created) => dispatch({ type: 'ADD_CONTACTS_BULK', payload: created }))
      .catch((err) => {
        console.error('addContactsBulk failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to import contacts'));
      });
  };

  const updateContact = (contact: Contact, changes?: Partial<Contact>): void => {
    dbUpdateContact(contact.id, changes ?? contact)
      .then(() =>
        dispatch({
          type: 'UPDATE_CONTACT',
          payload: { ...contact, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateContact failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to update contact'));
      });
  };

  const archiveContact = (id: string): void => {
    dbArchiveContact(id)
      .then(() => dispatch({ type: 'ARCHIVE_CONTACT', payload: id }))
      .catch((err) => {
        console.error('archiveContact failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to archive contact'));
      });
  };

  // Events
  const addEvent = (event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createEvent(event)
      .then((created) => dispatch({ type: 'ADD_EVENT', payload: created }))
      .catch((err) => {
        console.error('addEvent failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to save event'));
      });
  };

  const updateEvent = (event: Event, changes?: Partial<Event>): void => {
    dbUpdateEvent(event.id, changes ?? event)
      .then(() =>
        dispatch({
          type: 'UPDATE_EVENT',
          payload: { ...event, updatedAt: nowISO() },
        })
      )
      .catch((err) => {
        console.error('updateEvent failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to update event'));
      });
  };

  const archiveEvent = (id: string): void => {
    dbArchiveEvent(id)
      .then(() => dispatch({ type: 'ARCHIVE_EVENT', payload: id }))
      .catch((err) => {
        console.error('archiveEvent failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to archive event'));
      });
  };

  // Activities (Supabase-backed)
  const addActivity = async (activity: Omit<ActivityRecord, 'id'>): Promise<void> => {
    try {
      const created = await createActivity(activity);
      dispatch({ type: 'ADD_ACTIVITY', payload: created });
    } catch (err) {
      console.error('addActivity failed:', err);
      throw err;
    }
  };

  const archiveActivity = (id: string): void => {
    dbArchiveActivity(id)
      .then(() => dispatch({ type: 'ARCHIVE_ACTIVITY', payload: id }))
      .catch((err) => {
        console.error('archiveActivity failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to archive activity'));
      });
  };

  // Programs
  const addProgram = (program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>): void => {
    createProgram(program)
      .then((created) => dispatch({ type: 'ADD_PROGRAM', payload: created }))
      .catch((err) => {
        console.error('addProgram failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to save program'));
      });
  };

  const updateProgram = (program: Program): void => {
    dbUpdateProgram(program.id, program)
      .then(() => dispatch({ type: 'UPDATE_PROGRAM', payload: { ...program, updatedAt: nowISO() } }))
      .catch((err) => {
        console.error('updateProgram failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to update program'));
      });
  };

  const archiveProgram = (id: string): void => {
    dbArchiveProgram(id)
      .then(() => dispatch({ type: 'ARCHIVE_PROGRAM', payload: id }))
      .catch((err) => {
        console.error('archiveProgram failed:', err);
        toast.error(writeErrorMessage(err, 'Failed to archive program'));
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
        toast.error(writeErrorMessage(err, 'Failed to verify school'));
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
        toast.error(writeErrorMessage(err, 'Failed to bulk verify schools'));
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
        toast.error(writeErrorMessage(err, 'Failed to verify contact'));
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
        loadErrors,
        addSchool,
        addSchoolsBulk,
        updateSchool,
        archiveSchool,
        addContact,
        addContactsBulk,
        updateContact,
        archiveContact,
        addEvent,
        updateEvent,
        archiveEvent,
        addActivity,
        archiveActivity,
        addProgram,
        updateProgram,
        archiveProgram,
        verifySchool,
        verifySchoolsBulk,
        verifyContact,
        getSchoolById,
        getContactsBySchool,
        getActivitiesBySchool,
        getEventsBySchool,
        getProgramsBySchool,
        reload,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

/**
 * Re-provides the app's data with a different `state` to everything inside it,
 * e.g. only one US state's schools. Actions and per-school lookups are unchanged.
 */
export function AppStateOverride({ state: scoped, children }: { state: AppState; children: ReactNode }) {
  const ctx = useAppContext();
  const value = useMemo(() => ({ ...ctx, state: scoped }), [ctx, scoped]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
