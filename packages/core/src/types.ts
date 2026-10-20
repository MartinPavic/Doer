import type { ProfileKind, TaskStatus } from "./schemas";

// JSON shapes returned by the API (timestamps are ISO strings).
export interface Profile {
  id: string;
  userId: string;
  name: string;
  kind: ProfileKind;
  color: string;
  quietHours: unknown;
  defaultReminderOffset: number;
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
}
