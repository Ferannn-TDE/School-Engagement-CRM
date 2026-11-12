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
import type { School, Contact, Event, ActivityRecord, ActivityChanges, Program } from '../types';
import { attendanceByEvent, schoolsAtEvent } from '../utils/events';
import { todayDay } from '../utils/activityDates';
import { nowISO } from '../utils/helpers';
import {
  fetchSchools,
  createSchool,
  createSchoolsBulk,
  updateSchool as dbUpdateSchool,
  archiveSchool as dbArchiveSchool,
  setSchoolsVerified,
  fetchSchoolUpdateStamp,
  type VerificationStamp,
} from '../services/schoolsService';
import {
  fetchContacts,
  createContact,
  createContactsBulk,
  updateContact as dbUpdateContact,
  archiveContact as dbArchiveContact,
  setContactVerified,
  fetchContactUpdateStamp,
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
  updateActivity as dbUpdateActivity,
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
  | { type: 'UPDATE_ACTIVITY'; payload: ActivityRecord }
  | { type: 'ARCHIVE_ACTIVITY'; payload: string }
  | { type: 'SET_PROGRAMS'; payload: Program[] }
  | { type: 'ADD_PROGRAM'; payload: Program }
  | { type: 'UPDATE_PROGRAM'; payload: Program }
  | { type: 'ARCHIVE_PROGRAM'; payload: string }
  | { type: 'SET_SCHOOLS_VERIFIED'; payload: VerificationStamp[] }
  | { type: 'SET_CONTACT_VERIFIED'; payload: VerificationStamp }
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
    case 'UPDATE_ACTIVITY':
      return {
        ...state,
        activities: state.activities.map((a) => (a.id === action.payload.id ? action.payload : a)),
      };
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
    // Verify / Unverify: the stamps come back from the database (db/027). Switching
    // Verified isn't an update, so updatedAt is left alone.
    case 'SET_SCHOOLS_VERIFIED': {
      const byId = new Map(action.payload.map((v) => [v.id, v]));
      return {
        ...state,
        schools: state.schools.map((s) => {
          const v = byId.get(s.id);
          return v ? { ...s, isVerified: v.isVerified, lastVerifiedAt: v.lastVerifiedAt, verifiedBy: v.verifiedBy } : s;
        }),
      };
    }
    case 'SET_CONTACT_VERIFIED': {
      const v = action.payload;
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === v.id ? { ...c, isVerified: v.isVerified, lastVerifiedAt: v.lastVerifiedAt, verifiedBy: v.verifiedBy } : c
        ),
      };
    }
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
  /** Rejects on failure, so the panel keeps the edit open with what was typed. */
  updateActivity: (id: string, changes: ActivityChanges) => Promise<ActivityRecord>;
  archiveActivity: (id: string) => void;
  addProgram: (program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateProgram: (program: Program) => void;
  archiveProgram: (id: string) => void;
  verifySchool: (id: string) => void;
  unverifySchool: (id: string) => void;
  verifySchoolsBulk: (ids: string[]) => void;
  verifyContact: (id: string) => void;
  unverifyContact: (id: string) => void;
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
  // Refreshes in the background: the current data stays on screen until the new data
  // arrives, so an import, a restore or a Retry never shows the full-page spinner.
  const reload = useCallback(async () => {
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
      // The database decides whether this was a real change and stamps who and when (db/027).
      .then(() => fetchSchoolUpdateStamp(school.id).catch(() => ({})))
      .then((stamp) =>
        dispatch({
          type: 'UPDATE_SCHOOL',
          payload: { ...school, updatedAt: nowISO(), ...stamp },
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
      .then(() => fetchContactUpdateStamp(contact.id).catch(() => ({})))
      .then((stamp) =>
        dispatch({
          type: 'UPDATE_CONTACT',
          payload: { ...contact, updatedAt: nowISO(), ...stamp },
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

  const updateActivity = async (id: string, changes: ActivityChanges): Promise<ActivityRecord> => {
    const saved = await dbUpdateActivity(id, changes);
    dispatch({ type: 'UPDATE_ACTIVITY', payload: saved });
    return saved;
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

  // Verify / Unverify. The database stamps who and when (db/027); the reply carries them.
  const setSchoolsVerifiedState = (ids: string[], verified: boolean, done: string, failed: string): void => {
    if (ids.length === 0) return;
    setSchoolsVerified(ids, verified)
      .then((stamps) => {
        dispatch({ type: 'SET_SCHOOLS_VERIFIED', payload: stamps });
        toast.success(done);
      })
      .catch((err) => {
        console.error('setSchoolsVerified failed:', err);
        toast.error(writeErrorMessage(err, failed));
      });
  };
  const verifySchool = (id: string): void =>
    setSchoolsVerifiedState([id], true, 'School marked as verified', 'Failed to verify school');
  const unverifySchool = (id: string): void =>
    setSchoolsVerifiedState([id], false, 'School marked as unverified', 'Failed to unverify school');
  const verifySchoolsBulk = (ids: string[]): void =>
    setSchoolsVerifiedState(ids, true, `${ids.length} school${ids.length !== 1 ? 's' : ''} marked as verified`, 'Failed to bulk verify schools');

  const setContactVerifiedState = (id: string, verified: boolean): void => {
    setContactVerified(id, verified)
      .then((stamp) => {
        dispatch({ type: 'SET_CONTACT_VERIFIED', payload: stamp });
        toast.success(verified ? 'Contact marked as verified' : 'Contact marked as unverified');
      })
      .catch((err) => {
        console.error('setContactVerified failed:', err);
        toast.error(writeErrorMessage(err, verified ? 'Failed to verify contact' : 'Failed to unverify contact'));
      });
  };
  const verifyContact = (id: string): void => setContactVerifiedState(id, true);
  const unverifyContact = (id: string): void => setContactVerifiedState(id, false);

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
  // Listed on the event, or imported attendance for it (utils/events attendanceByEvent).
  const attendance = useMemo(() => attendanceByEvent(state.activities, todayDay()), [state.activities]);
  const getEventsBySchool = useCallback(
    (schoolId: string) => state.events.filter((e) => schoolsAtEvent(e, attendance).includes(schoolId)),
    [state.events, attendance]
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
        updateActivity,
        archiveActivity,
        addProgram,
        updateProgram,
        archiveProgram,
        verifySchool,
        unverifySchool,
        verifySchoolsBulk,
        verifyContact,
        unverifyContact,
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
