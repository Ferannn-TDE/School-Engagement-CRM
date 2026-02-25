import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { School, Contact, Event, ActivityRecord } from '../types';
import { loadFromStorage, saveToStorage } from '../utils/storage';
import { seedSchools, seedContacts, seedEvents, seedActivities } from '../constants/seedData';
import { generateId, nowISO } from '../utils/helpers';

interface AppState {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
}

type Action =
  | { type: 'SET_SCHOOLS'; payload: School[] }
  | { type: 'ADD_SCHOOL'; payload: School }
  | { type: 'UPDATE_SCHOOL'; payload: School }
  | { type: 'DELETE_SCHOOL'; payload: string }
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
  | { type: 'LOAD_STATE'; payload: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload;
    case 'SET_SCHOOLS':
      return { ...state, schools: action.payload };
    case 'ADD_SCHOOL':
      return { ...state, schools: [...state.schools, action.payload] };
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
    default:
      return state;
  }
}

const initialState: AppState = {
  schools: [],
  contacts: [],
  events: [],
  activities: [],
};

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addSchool: (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>) => void;
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
  getSchoolById: (id: string) => School | undefined;
  getContactsBySchool: (schoolId: string) => Contact[];
  getActivitiesBySchool: (schoolId: string) => ActivityRecord[];
  getEventsBySchool: (schoolId: string) => Event[];
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load data on mount
  useEffect(() => {
    const schools = loadFromStorage<School[]>('schools', []);
    const contacts = loadFromStorage<Contact[]>('contacts', []);
    const events = loadFromStorage<Event[]>('events', []);
    const activities = loadFromStorage<ActivityRecord[]>('activities', []);

    if (schools.length === 0 && contacts.length === 0) {
      // Seed with demo data
      dispatch({
        type: 'LOAD_STATE',
        payload: {
          schools: seedSchools,
          contacts: seedContacts,
          events: seedEvents,
          activities: seedActivities,
        },
      });
    } else {
      dispatch({
        type: 'LOAD_STATE',
        payload: { schools, contacts, events, activities },
      });
    }
  }, []);

  // Persist on change
  useEffect(() => {
    if (state.schools.length > 0 || state.contacts.length > 0) {
      saveToStorage('schools', state.schools);
      saveToStorage('contacts', state.contacts);
      saveToStorage('events', state.events);
      saveToStorage('activities', state.activities);
    }
  }, [state]);

  const addSchool = (school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = nowISO();
    dispatch({
      type: 'ADD_SCHOOL',
      payload: { ...school, id: generateId(), createdAt: now, updatedAt: now },
    });
  };

  const updateSchool = (school: School) => {
    dispatch({
      type: 'UPDATE_SCHOOL',
      payload: { ...school, updatedAt: nowISO() },
    });
  };

  const deleteSchool = (id: string) => {
    dispatch({ type: 'DELETE_SCHOOL', payload: id });
  };

  const addContact = (contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = nowISO();
    dispatch({
      type: 'ADD_CONTACT',
      payload: { ...contact, id: generateId(), createdAt: now, updatedAt: now },
    });
  };

  const addContactsBulk = (contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]) => {
    const now = nowISO();
    const newContacts = contacts.map((c) => ({
      ...c,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    }));
    dispatch({ type: 'ADD_CONTACTS_BULK', payload: newContacts });
  };

  const updateContact = (contact: Contact) => {
    dispatch({
      type: 'UPDATE_CONTACT',
      payload: { ...contact, updatedAt: nowISO() },
    });
  };

  const deleteContact = (id: string) => {
    dispatch({ type: 'DELETE_CONTACT', payload: id });
  };

  const addEvent = (event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = nowISO();
    dispatch({
      type: 'ADD_EVENT',
      payload: { ...event, id: generateId(), createdAt: now, updatedAt: now },
    });
  };

  const updateEvent = (event: Event) => {
    dispatch({
      type: 'UPDATE_EVENT',
      payload: { ...event, updatedAt: nowISO() },
    });
  };

  const deleteEvent = (id: string) => {
    dispatch({ type: 'DELETE_EVENT', payload: id });
  };

  const addActivity = (activity: Omit<ActivityRecord, 'id'>) => {
    dispatch({
      type: 'ADD_ACTIVITY',
      payload: { ...activity, id: generateId() },
    });
  };

  const getSchoolById = (id: string) => state.schools.find((s) => s.id === id);
  const getContactsBySchool = (schoolId: string) =>
    state.contacts.filter((c) => c.schoolId === schoolId);
  const getActivitiesBySchool = (schoolId: string) =>
    state.activities.filter((a) => a.schoolId === schoolId);
  const getEventsBySchool = (schoolId: string) =>
    state.events.filter((e) => e.participatingSchools.includes(schoolId));

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        addSchool,
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
        getSchoolById,
        getContactsBySchool,
        getActivitiesBySchool,
        getEventsBySchool,
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
