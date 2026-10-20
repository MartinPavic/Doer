import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { localParts } from "@doer/core/reminders";
import type { Db } from "./db/client";
import { calendar, calendarAccount, profile, task, taskCalendarLink } from "./db/schema";
import { GoogleAuthError, GoogleNotFoundError, type GoogleCalendar, type GoogleEventBody } from "./google";

type TaskRow = typeof task.$inferSelect;
type AccountRow = typeof calendarAccount.$inferSelect;
export type ClientFor = (account: AccountRow) => Promise<GoogleCalendar>;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const DEFAULT_MINUTES = 30;

/**
 * The Google event for a task. Tagged with `doerTaskId` so we can tell our own events apart (hide them from
 * the imported-events overlay, ignore their echoes). Google's own reminders are off: Doer handles those.
 * `forPatch` adds explicit nulls so a task can switch between all-day and timed.
 */
export function taskToEventBody(t: TaskRow, forPatch = false): GoogleEventBody {
  const base: GoogleEventBody = {
    summary: t.status === "done" ? `✓ ${t.title}` : t.title,
    description: t.notes ? `${t.notes}\n\n— from Doer` : "From Doer",
    reminders: { useDefault: false },
    extendedProperties: { private: { doerTaskId: t.id } },
  };
  const due = t.dueAt!;
  if (t.allDay) {
    const tz = t.tz || "UTC";
    const l = localParts(due, tz);
    const next = new Date(Date.UTC(l.y, l.m - 1, l.d + 1));
    return {
      ...base,
      start: { date: ymd(l.y, l.m, l.d), ...(forPatch && { dateTime: null }) },
      end: { date: ymd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), ...(forPatch && { dateTime: null }) },
    };
  }
  const start = t.startAt ?? due;
  const end = t.startAt && due > t.startAt ? due : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  const tz = t.tz ? { timeZone: t.tz } : {};
  return {
    ...base,
    start: { dateTime: start.toISOString(), ...tz, ...(forPatch && { date: null }) },
    end: { dateTime: end.toISOString(), ...tz, ...(forPatch && { date: null }) },
  };
}

export interface MirrorResult { created: number; updated: number; deleted: number; errors: number }

/**
 * Makes Google match the tasks. Pull-based and idempotent: every pass looks for tasks that should be mirrored but
 * aren't, tasks changed since their last push, and links whose task is gone/unscheduled/opted out, then fixes them.
 * A failed push simply shows up again next pass (cron every minute, plus a kick after each task edit).
 *
 * Recurring tasks mirror as a single event for their next occurrence, which moves on when it's completed.
 */
export async function reconcileMirrors(db: Db, clientFor: ClientFor, opts: { profileId?: string; limit?: number } = {}): Promise<MirrorResult> {
  const result: MirrorResult = { created: 0, updated: 0, deleted: 0, errors: 0 };
  const limit = opts.limit ?? 25;
  const inProfile = opts.profileId ? eq(profile.id, opts.profileId) : undefined;

  const clients = new Map<string, GoogleCalendar | null>(); // null = this account is unusable this pass
  const client = async (account: AccountRow) => {
    if (account.status !== "active") return null;
    if (!clients.has(account.id)) {
      try {
        clients.set(account.id, await clientFor(account));
      } catch (e) {
        if (e instanceof GoogleAuthError) await db.update(calendarAccount).set({ status: "reconnect" }).where(eq(calendarAccount.id, account.id));
        clients.set(account.id, null);
      }
    }
    return clients.get(account.id) ?? null;
  };
  const guard = async (account: AccountRow, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      result.errors++;
      if (e instanceof GoogleAuthError) {
        await db.update(calendarAccount).set({ status: "reconnect" }).where(eq(calendarAccount.id, account.id));
        clients.set(account.id, null);
      } else console.error("[mirror]", e);
    }
  };

  // Where each profile's tasks go.
  const targetRows = await db.select({ pid: profile.id, cal: calendar, acct: calendarAccount }).from(calendar)
    .innerJoin(calendarAccount, eq(calendar.accountId, calendarAccount.id))
    .innerJoin(profile, eq(calendarAccount.profileId, profile.id))
    .where(and(eq(calendar.isWriteTarget, true), eq(calendar.writable, true), eq(calendarAccount.status, "active"), inProfile));
  const targets = new Map(targetRows.map((r) => [r.pid, r]));

  const wantsMirror = and(
    isNull(task.deletedAt), isNotNull(task.dueAt),
    or(isNull(task.mirror), eq(task.mirror, true)),
    or(eq(profile.mirrorTasks, true), eq(task.mirror, true)),
  );

  // 1) Existing links that need a change or removal.
  const mismatch = [...targets].map(([pid, t]) => and(eq(task.profileId, pid), ne(taskCalendarLink.calendarId, t.cal.id)));
  const links = await db.select({ t: task, link: taskCalendarLink, cal: calendar, acct: calendarAccount, p: profile }).from(taskCalendarLink)
    .innerJoin(task, eq(taskCalendarLink.taskId, task.id))
    .innerJoin(profile, eq(task.profileId, profile.id))
    .innerJoin(calendar, eq(taskCalendarLink.calendarId, calendar.id))
    .innerJoin(calendarAccount, eq(calendar.accountId, calendarAccount.id))
    .where(and(inProfile, or(
      isNotNull(task.deletedAt), isNull(task.dueAt), eq(task.mirror, false),
      and(eq(profile.mirrorTasks, false), or(isNull(task.mirror), eq(task.mirror, false))),
      // Postgres keeps microseconds, JS Dates only milliseconds: compare at millisecond precision or every task looks "changed".
      sql`date_trunc('milliseconds', ${task.updatedAt}) > ${taskCalendarLink.lastSyncedAt}`,
      ...mismatch,
    )))
    .limit(limit);

  for (const { t, link, cal, acct, p } of links) {
    const google = await client(acct);
    if (!google) continue;
    await guard(acct, async () => {
      const keep = !t.deletedAt && !!t.dueAt && t.mirror !== false && (p.mirrorTasks || t.mirror === true);
      const target = targets.get(t.profileId);
      if (!keep) {
        await google.deleteEvent(cal.externalId, link.externalEventId);
        await db.delete(taskCalendarLink).where(eq(taskCalendarLink.taskId, t.id));
        result.deleted++;
        return;
      }
      if (target && target.cal.id !== link.calendarId) {
        // The user pointed mirroring at another calendar: move the event.
        const tgt = await client(target.acct);
        if (!tgt) return;
        await google.deleteEvent(cal.externalId, link.externalEventId);
        const ev = await tgt.insertEvent(target.cal.externalId, taskToEventBody(t));
        await db.update(taskCalendarLink).set({ calendarId: target.cal.id, externalEventId: ev.id, etag: ev.etag ?? null, lastSyncedAt: t.updatedAt })
          .where(eq(taskCalendarLink.taskId, t.id));
        result.updated++;
        return;
      }
      let ev;
      try {
        ev = await google.patchEvent(cal.externalId, link.externalEventId, taskToEventBody(t, true));
      } catch (e) {
        if (!(e instanceof GoogleNotFoundError)) throw e;
        ev = await google.insertEvent(cal.externalId, taskToEventBody(t)); // someone deleted it in Google: recreate
      }
      await db.update(taskCalendarLink).set({ externalEventId: ev.id, etag: ev.etag ?? null, lastSyncedAt: t.updatedAt })
        .where(eq(taskCalendarLink.taskId, t.id));
      result.updated++;
    });
  }

  // 2) Eligible tasks that have no event yet.
  if (targets.size > 0) {
    const fresh = await db.select({ t: task }).from(task)
      .innerJoin(profile, eq(task.profileId, profile.id))
      .leftJoin(taskCalendarLink, eq(taskCalendarLink.taskId, task.id))
      .where(and(isNull(taskCalendarLink.taskId), wantsMirror, inArray(task.profileId, [...targets.keys()]), inProfile))
      .limit(limit);
    for (const { t } of fresh) {
      const target = targets.get(t.profileId)!;
      const google = await client(target.acct);
      if (!google) continue;
      await guard(target.acct, async () => {
        const ev = await google.insertEvent(target.cal.externalId, taskToEventBody(t));
        await db.insert(taskCalendarLink).values({
          taskId: t.id, calendarId: target.cal.id, externalEventId: ev.id, etag: ev.etag ?? null, lastSyncedAt: t.updatedAt,
        }).onConflictDoNothing();
        result.created++;
      });
    }
  }
  return result;
}
