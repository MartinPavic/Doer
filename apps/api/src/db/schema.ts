import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, type AnyPgColumn } from "drizzle-orm/pg-core";
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
