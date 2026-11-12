import type { PendingMap } from '../utils/pending';
export enum ProgramCategory {
  CS = 'cs',
  ENGINEERING = 'engineering',
  ROBOTICS = 'robotics',
  STEM_CLUB = 'stem_club',
  MATH_CLUB = 'math_club',
  SCIENCE_CLUB = 'science_club',
  OTHER = 'other',
}

export const ProgramCategoryLabels: Record<ProgramCategory, string> = {
  [ProgramCategory.CS]: 'Computer Science',
  [ProgramCategory.ENGINEERING]: 'Engineering',
  [ProgramCategory.ROBOTICS]: 'Robotics',
  [ProgramCategory.STEM_CLUB]: 'STEM Club',
  [ProgramCategory.MATH_CLUB]: 'Math Club',
  [ProgramCategory.SCIENCE_CLUB]: 'Science Club',
  [ProgramCategory.OTHER]: 'Other',
};

export interface Program {
  id: string;
  schoolId: string;
  name: string;
  category: ProgramCategory;
  /** The "Please specify" text when category is 'other' (db/028). */
  categoryOther?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum ContactRole {
  SUPERINTENDENT = 'superintendent',
  PRINCIPAL = 'principal',
  COUNSELOR = 'counselor',
  CS_TEACHER = 'cs_teacher',
  ENGINEERING_TEACHER = 'engineering_teacher',
  MATH_TEACHER = 'math_teacher',
  SCIENCE_TEACHER = 'science_teacher',
  /** Has a job title that fits none of the categories above, e.g. Social Worker. */
  OTHER = 'other',
  /** No job title recorded. */
  UNSPECIFIED = 'unspecified',
}

export const ContactRoleLabels: Record<ContactRole, string> = {
  [ContactRole.SUPERINTENDENT]: 'Superintendent',
  [ContactRole.PRINCIPAL]: 'Principal',
  [ContactRole.COUNSELOR]: 'Counselor',
  [ContactRole.CS_TEACHER]: 'CS Teacher',
  [ContactRole.ENGINEERING_TEACHER]: 'Engineering Teacher',
  [ContactRole.MATH_TEACHER]: 'Math Teacher',
  [ContactRole.SCIENCE_TEACHER]: 'Science Teacher',
  [ContactRole.OTHER]: 'Other',
  [ContactRole.UNSPECIFIED]: 'Unspecified',
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
  /** The job title as recorded (staff.job_name), e.g. "Social Worker". */
  title?: string;
  schoolId: string;
  isActive: boolean;
  notes?: string;
  dataSource?: 'manual' | 'imported' | 'scraped';
  isVerified?: boolean;
  /** When Verified was last switched on or off, and by whom (db/027). */
  lastVerifiedAt?: string;
  verifiedBy?: string;
  /** updated_at as stored: the last real content change since db/027 (undefined when
   *  blank). updatedAt is the same with a fallback, for code that needs a date. */
  lastUpdatedAt?: string;
  /** Who made that change: an email, or 'database' (scraper, SQL Editor). Blank on rows not changed since 027. */
  updatedBy?: string;
  /** Freshness (db/011), written by the scraper. */
  lastScrapedAt?: string;
  missedRuns?: number;
  missingSince?: string;
  /** Fields a person edited, locked against the scraper (db/006). */
  lockedFields?: string[];
  /** What the scraper found for locked fields (db/006, db/012). */
  pendingScraped?: PendingMap;
  createdAt: string;
  updatedAt: string;
  lastContactDate?: string;
}

export interface School {
  id: string;
  name: string;
  /** schools.district_id: the scraper's internal id for the district. Not shown to users. */
  district?: string;
  /** The district's name, from the district table. Shown instead of the id. */
  districtName?: string;
  county: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  /** The school's main phone number, from the state's school list. */
  phone?: string;
  /** The school's website as found by the scraper. */
  website?: string;
  /** The client's own links (db/013), used instead of what the scraper found. */
  websiteOverride?: string;
  staffPageOverride?: string;
  schoolType: SchoolType;
  isActive: boolean;
  notes?: string;
  enrollment?: number;
  gradeRange?: string;
  dataSource?: 'manual' | 'imported' | 'scraped';
  isVerified?: boolean;
  /** When Verified was last switched on or off, and by whom (db/027). */
  lastVerifiedAt?: string;
  verifiedBy?: string;
  /** updated_at as stored: the last real content change since db/027 (undefined when
   *  blank). updatedAt is the same with a fallback, for code that needs a date. */
  lastUpdatedAt?: string;
  /** Who made that change: an email, or 'database' (scraper, SQL Editor). Blank on rows not changed since 027. */
  updatedBy?: string;
  /** Freshness (db/011), written by the scraper. */
  lastScrapedAt?: string;
  sourceStatus?: 'working' | 'broken' | 'not_found';
  sourceCheckedAt?: string;
  missedRuns?: number;
  missingSince?: string;
  /** Fields a person edited, locked against the scraper (db/006). */
  lockedFields?: string[];
  /** What the scraper found for locked fields (db/006, db/012). */
  pendingScraped?: PendingMap;
  priorityTier?: 'high' | 'standard' | 'low';
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  name: string;
  /** Saved since db/028; undefined = "Not set" (events saved before, and scraped ones). */
  type?: EventType;
  /** The "Please specify" text when type is 'other' (db/028). */
  typeOther?: string;
  /** Local date and time, "2026-11-12T18:30:00" (Central time for scraped events). */
  date: string;
  /** False for all-day events and events with no recorded time: show the date only. */
  hasTime?: boolean;
  /** Where the event came from: a school's calendar, IACAC, or entered in the app. */
  source?: 'school_calendar' | 'iacac' | 'manual';
  /** events.category (db/007). 'school_testing_date' = a busy date, not outreach. */
  category?: string;
  endDate?: string;
  location: string;
  participatingSchools: string[];
  attendeeCount?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** How a logged contact happened. Stored as-is in activities.activity_type. */
export const ContactMethodLabels: Record<string, string> = {
  call: 'Phone call',
  email: 'Email',
  visit: 'Visit',
  other: 'Other',
};

/**
 * Activity types where people are there in person, so a visitor count makes sense:
 * a visit, attendance at an event (imports, campus visits and fairs are saved as
 * event_participation), and Other (db/028). Calls and emails have no visitors.
 */
export const IN_PERSON_ACTIVITY_TYPES: readonly string[] = ['visit', 'event_participation', 'other'];

export interface ActivityRecord {
  id: string;
  schoolId: string;
  contactId?: string;
  eventId?: string;
  activityType: string;
  date: string;
  description: string;
  outcome?: string;
  /** Set on activities saved by Import → Import Activities (db/022). */
  importBatchId?: string;
  /** Number of visitors: entered on a logged visit, or counted by an import (db/022). */
  attendeeCount?: number;
  /** The "Please specify" text when activityType is 'other' (db/028). */
  activityTypeOther?: string;
  /** Who logged it, and who last changed its content and when (db/026). Empty on rows saved before 026. */
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** The fields an editor can change on a logged activity (visit details panel). */
export type ActivityChanges = Pick<ActivityRecord, 'activityType' | 'date' | 'description'> & {
  activityTypeOther: string | null;
  contactId: string | null;
  eventId: string | null;
  attendeeCount: number | null;
};

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
