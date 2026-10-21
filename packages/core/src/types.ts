import type { QuietHours } from "./reminders";
import type { ProfileKind, TaskStatus } from "./schemas";

// JSON shapes returned by the API (timestamps are ISO strings).
export interface Profile {
  id: string;
  userId: string;
  name: string;
  kind: ProfileKind;
  color: string;
  quietHours: QuietHours | null;
  defaultReminderOffset: number;
  allDayReminderTime: string;
  mirrorTasks: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: number;
  sortOrder: number;
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  tz: string | null;
  rrule: string | null;
  completedAt: string | null;
  mirror: boolean | null;
  createdAt: string;
  updatedAt: string;
  /** Calendar responses only, for recurring tasks: occurrences already completed in the requested window. */
  doneOccurrences?: string[];
}

export interface Reminder {
  id: string;
  taskId: string;
  offsetMinutes: number | null;
  baseAt: string;
  fireAt: string;
  firedAt: string | null;
  dismissedAt: string | null;
}

/** What the desktop scheduler polls: a pending reminder plus enough task/profile context to notify. */
export interface UpcomingReminder {
  id: string;
  taskId: string;
  profileId: string;
  profileName: string;
  title: string;
  fireAt: string;
}

export interface Device {
  id: string;
  kind: "web" | "desktop";
  label: string;
  notifyHere: boolean;
  lastSeenAt: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color: string | null;
  selected: boolean;
  isWriteTarget: boolean;
  /** Owner/writer access: eligible as a mirror target. */
  writable: boolean;
  lastSyncedAt: string | null;
}

export interface CalendarAccount {
  id: string;
  provider: "google" | "microsoft";
  email: string;
  /** "reconnect": the provider rejected our access (revoked/expired) and the user must sign in again. */
  status: "active" | "reconnect";
  calendars: CalendarInfo[];
}

/** An event from a connected calendar (read-only in Doer). All-day events carry UTC-midnight dates. */
export interface ExternalEvent {
  id: string;
  calendarId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  color: string | null;
  link: string | null;
}
