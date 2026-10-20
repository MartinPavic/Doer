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
  /** Mirror this profile's timed tasks into its write-target calendar. */
  mirrorTasks: boolean("mirror_tasks").notNull().default(false),
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
  /** Per-task override of the profile's mirror setting: null = follow the profile, true = always, false = never. */
  mirror: boolean("mirror"),
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

/** History of completed occurrences of recurring tasks (the task itself always points at the *next* one). */
export const taskOccurrence = pgTable("task_occurrence", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  occurrenceAt: timestamp("occurrence_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("task_occurrence_unique").on(t.taskId, t.occurrenceAt)]);

/**
 * An external calendar login (Google now, Microsoft later) attached to ONE profile, so a work
 * calendar and a private one never mix. The refresh token is AES-GCM encrypted; clients never see it.
 */
export const calendarAccount = pgTable("calendar_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
  externalEmail: text("external_email").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scopes: text("scopes").notNull(),
  /** "reconnect" once the provider rejects the refresh token (revoked / expired). */
  status: text("status", { enum: ["active", "reconnect"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("calendar_account_profile_idx").on(t.profileId),
  uniqueIndex("calendar_account_unique").on(t.profileId, t.provider, t.externalEmail),
]);

export const calendar = pgTable("calendar", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => calendarAccount.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
  /** Shown on the Doer calendar and kept in sync. */
  selected: boolean("selected").notNull().default(false),
  /** The user can add events here (owner/writer), so it can be a mirror target. */
  writable: boolean("writable").notNull().default(false),
  /** Where this profile's tasks get mirrored (at most one per profile). */
  isWriteTarget: boolean("is_write_target").notNull().default(false),
  /** Google sync token / Graph delta link for incremental sync. */
  syncToken: text("sync_token"),
  watchChannelId: text("watch_channel_id"),
  watchResourceId: text("watch_resource_id"),
  watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
}, (t) => [uniqueIndex("calendar_external_unique").on(t.accountId, t.externalId)]);

/** Local cache of external events (read-only in Doer unless linked to a task). */
export const calendarEvent = pgTable("calendar_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarId: uuid("calendar_id").notNull().references(() => calendar.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  etag: text("etag"),
  title: text("title").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  rrule: text("rrule"),
  raw: jsonb("raw"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("calendar_event_external_unique").on(t.calendarId, t.externalId),
  index("calendar_event_range_idx").on(t.calendarId, t.startAt),
]);

/** A task mirrored as an external event. `lastSyncedAt` is the task.updatedAt we last pushed. */
export const taskCalendarLink = pgTable("task_calendar_link", {
  taskId: uuid("task_id").primaryKey().references(() => task.id, { onDelete: "cascade" }),
  calendarId: uuid("calendar_id").notNull().references(() => calendar.id, { onDelete: "cascade" }),
  externalEventId: text("external_event_id").notNull(),
  etag: text("etag"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("task_link_event_unique").on(t.calendarId, t.externalEventId)]);
