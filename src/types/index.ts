export enum ContactRole {
  SUPERINTENDENT = 'superintendent',
  PRINCIPAL = 'principal',
  COUNSELOR = 'counselor',
  CS_TEACHER = 'cs_teacher',
  ENGINEERING_TEACHER = 'engineering_teacher',
  MATH_TEACHER = 'math_teacher',
  SCIENCE_TEACHER = 'science_teacher',
}

export const ContactRoleLabels: Record<ContactRole, string> = {
  [ContactRole.SUPERINTENDENT]: 'Superintendent',
  [ContactRole.PRINCIPAL]: 'Principal',
  [ContactRole.COUNSELOR]: 'Counselor',
  [ContactRole.CS_TEACHER]: 'CS Teacher',
  [ContactRole.ENGINEERING_TEACHER]: 'Engineering Teacher',
  [ContactRole.MATH_TEACHER]: 'Math Teacher',
  [ContactRole.SCIENCE_TEACHER]: 'Science Teacher',
};

export enum EventType {
  OUTREACH_FAIR = 'outreach_fair',
  CAMPUS_VISIT = 'campus_visit',
  RECRUITMENT_EVENT = 'recruitment_event',
  SUMMER_CAMP = 'summer_camp',
  WORKSHOP = 'workshop',
  OTHER = 'other',
}

export const EventTypeLabels: Record<EventType, string> = {
  [EventType.OUTREACH_FAIR]: 'Outreach Fair',
  [EventType.CAMPUS_VISIT]: 'Campus Visit',
  [EventType.RECRUITMENT_EVENT]: 'Recruitment Event',
  [EventType.SUMMER_CAMP]: 'Summer Camp',
  [EventType.WORKSHOP]: 'Workshop',
  [EventType.OTHER]: 'Other',
};

export type SchoolType = 'high_school' | 'middle_school';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: ContactRole;
  schoolId: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastContactDate?: string;
}

export interface School {
  id: string;
  name: string;
  district?: string;
  county: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  schoolType: SchoolType;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  name: string;
  type: EventType;
  date: string;
  endDate?: string;
  location: string;
  participatingSchools: string[];
  attendeeCount?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  schoolId: string;
  contactId?: string;
  eventId?: string;
  activityType: string;
  date: string;
  description: string;
  outcome?: string;
}

export interface FilterState {
  search: string;
  county?: string;
  schoolType?: SchoolType;
  contactRole?: ContactRole;
  eventType?: EventType;
  isActive?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface AppState {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
}

export type ColumnMapping = Record<string, string>;

export interface ImportPreview {
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}
