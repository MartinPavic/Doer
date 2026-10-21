import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { CreateTaskInput, ListTasksQuery, UpdateProfileInput, UpdateTaskInput } from "@doer/core/schemas";
import { nextOccurrence } from "@doer/core/recurrence";
import { baseFireAt, deferOutOfQuiet, quietHours } from "@doer/core/reminders";
import { calendarsFor } from "./calendar-service";
import type { Db } from "./db/client";
import { profile, reminder, task, taskOccurrence } from "./db/schema";

const toDate = (v: string | null | undefined) => (v == null ? v : new Date(v));

type ProfileRow = typeof profile.$inferSelect;
type TaskRow = typeof task.$inferSelect;

/** When a due-date reminder should fire, or undefined if there's nothing worth reminding about. */
function planReminder(p: ProfileRow, t: Pick<TaskRow, "dueAt" | "allDay" | "tz">, offsetMinutes: number, now = new Date()) {
  if (!t.dueAt) return undefined;
  if (!t.allDay && t.dueAt <= now) return undefined; // already overdue
  let base = baseFireAt({ dueAt: t.dueAt, allDay: t.allDay, tz: t.tz, offsetMinutes, allDayTime: p.allDayReminderTime });
  if (base < now) {
    if (t.allDay) return undefined; // don't ping late for an all-day task
    base = now; // due soon, inside the lead time: remind right away
  }
  const q = quietHours.safeParse(p.quietHours).data ?? null;
  return { baseAt: base, fireAt: deferOutOfQuiet(base, q) };
}

/**
 * The only way routes touch tenant data: resolves the profile for this user
 * (undefined if it isn't theirs) and returns task queries pinned to it.
 */
export async function withProfile(db: Db, userId: string, profileId: string) {
  const [p] = await db
    .select()
    .from(profile)
    .where(and(eq(profile.id, profileId), eq(profile.userId, userId)));
  if (!p) return undefined;

  const mine = (id: string) =>
    and(eq(task.id, id), eq(task.profileId, p.id), isNull(task.deletedAt));

  /** Replaces the task's due-date reminder (null = none). Snoozed/absolute reminders are left alone. */
  async function setOffsetReminder(t: TaskRow, offset: number | null) {
    await db.delete(reminder).where(and(eq(reminder.taskId, t.id), isNotNull(reminder.offsetMinutes)));
    if (offset == null) return;
    const plan = planReminder(p!, t, offset);
    if (plan) await db.insert(reminder).values({ taskId: t.id, offsetMinutes: offset, ...plan });
  }

  /** Pending reminders of this profile, with ownership enforced through the task. */
  const ownedReminder = async (id: string) => {
    const [row] = await db.select({ r: reminder, t: task }).from(reminder)
      .innerJoin(task, eq(reminder.taskId, task.id))
      .where(and(eq(reminder.id, id), eq(task.profileId, p.id), isNull(task.deletedAt)));
    return row;
  };

  return {
    profile: p,
    calendars: calendarsFor(db, p.id),
    /** Updates profile settings; quiet-hours / all-day-time changes re-time every pending reminder. */
    async updateSettings(input: UpdateProfileInput) {
      const [updated] = await db.update(profile).set(input).where(eq(profile.id, p.id)).returning();
      if (!updated) return undefined;
      if (input.quietHours !== undefined || input.allDayReminderTime !== undefined) {
        const q = quietHours.safeParse(updated.quietHours).data ?? null;
        const pending = await db.select({ r: reminder, t: task }).from(reminder)
          .innerJoin(task, eq(reminder.taskId, task.id))
          .where(and(eq(task.profileId, p.id), isNull(task.deletedAt), isNull(reminder.firedAt), isNull(reminder.dismissedAt)));
        for (const { r, t } of pending) {
          const plan = r.offsetMinutes == null ? undefined : planReminder(updated, t, r.offsetMinutes);
          const baseAt = plan?.baseAt ?? r.baseAt;
          await db.update(reminder).set({ baseAt, fireAt: deferOutOfQuiet(baseAt, q) }).where(eq(reminder.id, r.id));
        }
      }
      return updated;
    },
    reminders: {
      /** Everything not dismissed for live to-do tasks (unfired = scheduled, fired = awaiting action). */
      async list() {
        const rows = await db.select({ r: reminder }).from(reminder)
          .innerJoin(task, eq(reminder.taskId, task.id))
          .where(and(eq(task.profileId, p.id), isNull(task.deletedAt), eq(task.status, "todo"), isNull(reminder.dismissedAt)))
          .orderBy(asc(reminder.fireAt));
        return rows.map((x) => x.r);
      },
      async snooze(id: string, minutes: number) {
        if (!(await ownedReminder(id))) return undefined;
        const baseAt = new Date(Date.now() + minutes * 60_000);
        const q = quietHours.safeParse(p.quietHours).data ?? null;
        const [r] = await db.update(reminder)
          .set({ offsetMinutes: null, baseAt, fireAt: deferOutOfQuiet(baseAt, q), firedAt: null, dismissedAt: null })
          .where(eq(reminder.id, id)).returning();
        return r;
      },
      async dismiss(id: string) {
        if (!(await ownedReminder(id))) return undefined;
        const [r] = await db.update(reminder).set({ dismissedAt: new Date() }).where(eq(reminder.id, id)).returning();
        return r;
      },
    },
    tasks: {
      async list(q: ListTasksQuery) {
        const live = and(eq(task.profileId, p.id), isNull(task.deletedAt));
        const dayStart = toDate(q.dayStart);
        const dayEnd = toDate(q.dayEnd);
        switch (q.view) {
          case "today": // overdue + due today + undated (quick-added tasks have no due date)
            return db.select().from(task)
              .where(and(live, eq(task.status, "todo"), dayEnd ? or(isNull(task.dueAt), lt(task.dueAt, dayEnd)) : undefined))
              .orderBy(asc(task.sortOrder), asc(task.dueAt), desc(task.priority), desc(task.createdAt));
          case "upcoming":
            return db.select().from(task)
              .where(and(live, eq(task.status, "todo"), dayEnd ? gte(task.dueAt, dayEnd) : undefined))
              .orderBy(asc(task.sortOrder), asc(task.dueAt), desc(task.priority));
          case "done":
            return db.select().from(task)
              .where(and(live, eq(task.status, "done"), dayStart ? gte(task.completedAt, dayStart) : undefined))
              .orderBy(desc(task.completedAt));
          default:
            return db.select().from(task).where(live).orderBy(asc(task.sortOrder), desc(task.createdAt));
        }
      },
      /** Tasks that belong on a calendar between `from` and `to`; recurring ones always (they expand client-side). */
      async listRange(from: Date, to: Date) {
        const starts = sql`coalesce(${task.startAt}, ${task.dueAt})`;
        const ends = sql`coalesce(${task.dueAt}, ${task.startAt})`;
        const rows = await db.select().from(task).where(and(
          eq(task.profileId, p.id),
          isNull(task.deletedAt),
          or(isNotNull(task.rrule), and(sql`${starts} < ${to}`, sql`${ends} >= ${from}`)),
        )).orderBy(asc(task.dueAt));
        const recurring = rows.filter((r) => r.rrule).map((r) => r.id);
        if (recurring.length === 0) return rows;
        const done = await db.select().from(taskOccurrence).where(and(
          inArray(taskOccurrence.taskId, recurring), gte(taskOccurrence.occurrenceAt, from), lt(taskOccurrence.occurrenceAt, to),
        ));
        return rows.map((r) =>
          r.rrule ? { ...r, doneOccurrences: done.filter((o) => o.taskId === r.id).map((o) => o.occurrenceAt.toISOString()) } : r,
        );
      },
      async get(id: string) {
        const [t] = await db.select().from(task).where(mine(id));
        return t;
      },
      async create(input: CreateTaskInput) {
        if (input.parentId && !(await this.get(input.parentId))) return undefined;
        const { reminderOffset, ...fields } = input;
        const [t] = await db.insert(task).values({
          ...fields,
          startAt: toDate(input.startAt),
          dueAt: toDate(input.dueAt),
          profileId: p.id,
        }).onConflictDoNothing({ target: task.id }).returning();
        // Replayed create: return the existing row, but only if it's ours (get() is profile-scoped).
        if (!t) return input.id ? this.get(input.id) : undefined;
        if (t.dueAt) await setOffsetReminder(t, reminderOffset === undefined ? p.defaultReminderOffset : reminderOffset);
        return t;
      },
      async update(id: string, input: UpdateTaskInput) {
        const { status, startAt, dueAt, reminderOffset, ...rest } = input;
        const before = await this.get(id);
        if (!before) return undefined;

        // Completing a recurring task records this occurrence and moves the task on to the next one
        // (it only becomes "done" for good when the rule has run out).
        const completing = status === "done" && before.status !== "done" && !!before.rrule && !!before.dueAt;
        const next = completing ? nextOccurrence({ dueAt: before.dueAt!, rrule: before.rrule!, tz: before.tz }) : null;
        if (completing) {
          await db.insert(taskOccurrence).values({ taskId: id, occurrenceAt: before.dueAt! }).onConflictDoNothing();
        }

        const [t] = await db.update(task).set({
          ...rest,
          ...(startAt !== undefined && { startAt: toDate(startAt) }),
          ...(dueAt !== undefined && { dueAt: toDate(dueAt) }),
          ...(next
            ? {
                dueAt: next,
                startAt: before.startAt ? new Date(before.startAt.getTime() + (next.getTime() - before.dueAt!.getTime())) : before.startAt,
                status: "todo" as const,
                completedAt: null,
              }
            : status !== undefined && { status, completedAt: status === "done" ? new Date() : null }),
          // Reordering isn't a content change: leave updatedAt alone so it doesn't trigger a calendar re-push.
          ...(!Object.keys(input).every((k) => k === "sortOrder") && { updatedAt: new Date() }),
        }).where(mine(id)).returning();
        if (!t) return undefined;

        const timeChanged = t.dueAt?.getTime() !== before.dueAt?.getTime() || t.allDay !== before.allDay || t.tz !== before.tz;
        if (reminderOffset !== undefined) {
          await setOffsetReminder(t, reminderOffset);
        } else if (timeChanged) {
          // Keep the lead time the task already had; a task that just got its first due date gets the default.
          const [existing] = await db.select({ o: reminder.offsetMinutes }).from(reminder)
            .where(and(eq(reminder.taskId, t.id), isNotNull(reminder.offsetMinutes)));
          const offset = existing?.o ?? (before.dueAt ? null : p.defaultReminderOffset);
          await setOffsetReminder(t, t.dueAt ? offset : null);
        }
        return t;
      },
      async remove(id: string) {
        const now = new Date();
        const [t] = await db.update(task)
          .set({ deletedAt: now, updatedAt: now })
          .where(mine(id)).returning({ id: task.id });
        if (t) {
          await db.update(task).set({ deletedAt: now, updatedAt: now })
            .where(and(eq(task.parentId, id), eq(task.profileId, p.id), isNull(task.deletedAt)));
        }
        return !!t;
      },
    },
  };
}
