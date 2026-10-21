import { z } from "zod";
import { isValidRrule } from "./recurrence";
import { quietHours } from "./reminders";

export const profileKind = z.enum(["work", "private"]);
export type ProfileKind = z.infer<typeof profileKind>;

export const taskStatus = z.enum(["todo", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatus>;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const createProfileInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: profileKind,
  color: color.optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileInput>;

const reminderOffset = z.number().int().min(0).max(60 * 24 * 30);

export const updateProfileInput = z.object({
  name: z.string().trim().min(1).max(60),
  color,
  defaultReminderOffset: reminderOffset,
  allDayReminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietHours: quietHours.nullable(),
  /** Mirror this profile's timed tasks into its write-target calendar. */
  mirrorTasks: z.boolean(),
}).partial();
export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

const taskFields = {
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).nullable(),
  priority: z.number().int().min(0).max(3),
  sortOrder: z.number().int().min(0).max(1_000_000),
  startAt: z.iso.datetime({ offset: true }).nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  allDay: z.boolean(),
  tz: z.string().max(64).nullable(),
  rrule: z.string().max(500).refine(isValidRrule, "Invalid repeat rule").nullable(),
  parentId: z.uuid().nullable(),
  /** Minutes before due to remind. Omit on create for the profile default; null for no reminder. */
  reminderOffset: reminderOffset.nullable(),
  /** Overrides the profile's mirroring: true = always, false = never, null = follow the profile. */
  mirror: z.boolean().nullable(),
};

export const createTaskInput = z.object({ title: taskFields.title }).extend({
  ...z.object(taskFields).partial().omit({ title: true }).shape,
  // Client-generated so offline creates are idempotent when the outbox replays them.
  id: z.uuid().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = z
  .object({ ...taskFields, status: taskStatus })
  .partial()
  .omit({ parentId: true });
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

export const taskView = z.enum(["today", "upcoming", "done", "all"]);
export type TaskView = z.infer<typeof taskView>;

export const listTasksQuery = z.object({
  view: taskView.default("all"),
  // Client's local day boundaries: the server doesn't know the user's timezone.
  dayStart: z.iso.datetime({ offset: true }).optional(),
  dayEnd: z.iso.datetime({ offset: true }).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

export const snoozeInput = z.object({ minutes: z.number().int().min(1).max(60 * 24 * 7) });
export type SnoozeInput = z.infer<typeof snoozeInput>;

export const deviceInput = z.object({
  kind: z.enum(["web", "desktop"]),
  label: z.string().trim().min(1).max(100),
  notifyHere: z.boolean().optional(),
});
export type DeviceInput = z.infer<typeof deviceInput>;

export const pushSubscriptionInput = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

export const calendarQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type CalendarQuery = z.infer<typeof calendarQuery>;
