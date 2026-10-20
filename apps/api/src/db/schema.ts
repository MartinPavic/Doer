import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["work", "private"] }).notNull(),
  color: text("color").notNull().default("#6366f1"),
  quietHours: jsonb("quiet_hours"),
  defaultReminderOffset: integer("default_reminder_offset").notNull().default(10),
  allDayReminderTime: text("all_day_reminder_time").notNull().default("09:00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("profile_user_idx").on(t.userId)]);

export const task = pgTable("task", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["todo", "done", "cancelled"] }).notNull().default("todo"),
  priority: integer("priority").notNull().default(0),
  startAt: timestamp("start_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  tz: text("tz"),
  rrule: text("rrule"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("task_profile_due_idx").on(t.profileId, t.dueAt),
  index("task_parent_idx").on(t.parentId),
]);

/**
 * `baseAt` is when the reminder wants to fire; `fireAt` is that moved out of quiet hours and is the
 * only column dispatchers watch. `offsetMinutes` is set for the task's due-date reminder (recomputed
 * when the due date or profile settings change) and null for snoozed/absolute ones.
 */
export const reminder = pgTable("reminder", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  offsetMinutes: integer("offset_minutes"),
  baseAt: timestamp("base_at", { withTimezone: true }).notNull(),
  fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
  firedAt: timestamp("fired_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("reminder_task_idx").on(t.taskId),
  index("reminder_due_idx").on(t.fireAt).where(sql`${t.firedAt} is null`),
]);

/** One row per browser/desktop install; `notifyHere` decides which devices actually alert. */
export const device = pgTable("device", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["web", "desktop"] }).notNull(),
  label: text("label").notNull(),
  notifyHere: boolean("notify_here").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("device_user_idx").on(t.userId)]);

export const pushSubscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("push_endpoint_idx").on(t.endpoint)]);
