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
  startAt: string | null;
  dueAt: string | null;
  allDay: boolean;
  tz: string | null;
  rrule: string | null;
  completedAt: string | null;
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
