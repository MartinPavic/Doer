import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { DeviceInput, PushSubscriptionInput } from "@doer/core/schemas";
import type { Db } from "./db/client";
import { calendar, calendarAccount, device, profile, pushSubscription, reminder, task, taskOccurrence, user } from "./db/schema";

/** Cross-profile, per-user queries (devices and the desktop scheduler's feed). Always filtered by userId. */
export function forUser(db: Db, userId: string) {
  return {
    devices: {
      list: () => db.select().from(device).where(eq(device.userId, userId)).orderBy(asc(device.label)),

      /** Idempotent register/heartbeat. Returns undefined if the id belongs to another user. */
      async upsert(id: string, input: DeviceInput) {
        const [existing] = await db.select().from(device).where(eq(device.id, id));
        if (existing && existing.userId !== userId) return undefined;
        const [d] = await db.insert(device).values({
          id, userId, kind: input.kind, label: input.label,
          // Desktop alerts by default (it hosts the scheduler); web only once the user opts in.
          notifyHere: input.notifyHere ?? input.kind === "desktop",
        }).onConflictDoUpdate({
          target: device.id,
          set: {
            label: input.label,
            lastSeenAt: new Date(),
            ...(input.notifyHere !== undefined && { notifyHere: input.notifyHere }),
          },
        }).returning();
        return d;
      },
    },

    /**
     * Everything the user owns, as plain JSON for backup / moving elsewhere. Deliberately leaves out secrets
     * (OAuth tokens, push keys, password hashes) and re-derivable caches (imported calendar events).
     */
    async exportAll() {
      const [me] = await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, userId));
      const profiles = await db.select().from(profile).where(eq(profile.userId, userId)).orderBy(asc(profile.createdAt));
      const ids = profiles.map((p) => p.id);
      const tasks = ids.length ? await db.select().from(task).where(and(inArray(task.profileId, ids), isNull(task.deletedAt))).orderBy(asc(task.createdAt)) : [];
      const taskIds = tasks.map((t) => t.id);
      const occurrences = taskIds.length ? await db.select().from(taskOccurrence).where(inArray(taskOccurrence.taskId, taskIds)) : [];
      const reminders = taskIds.length ? await db.select().from(reminder).where(inArray(reminder.taskId, taskIds)) : [];
      const accounts = ids.length
        ? await db.select({ id: calendarAccount.id, profileId: calendarAccount.profileId, provider: calendarAccount.provider, email: calendarAccount.externalEmail }).from(calendarAccount).where(inArray(calendarAccount.profileId, ids))
        : [];
      const calendars = accounts.length
        ? await db.select({ accountId: calendar.accountId, name: calendar.name, selected: calendar.selected, isWriteTarget: calendar.isWriteTarget }).from(calendar).where(inArray(calendar.accountId, accounts.map((a) => a.id)))
        : [];

      return {
        app: "doer",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        user: me ?? null,
        profiles: profiles.map(({ userId: _u, ...p }) => ({
          ...p,
          calendarAccounts: accounts.filter((a) => a.profileId === p.id).map(({ profileId: _p, ...a }) => ({
            ...a, calendars: calendars.filter((c) => c.accountId === a.id).map(({ accountId: _a, ...c }) => c),
          })),
          tasks: tasks.filter((t) => t.profileId === p.id).map((t) => ({
            ...t,
            completedOccurrences: occurrences.filter((o) => o.taskId === t.id).map((o) => o.occurrenceAt),
            reminders: reminders.filter((r) => r.taskId === t.id),
          })),
        })),
      };
    },

    push: {
      /** One subscription per device; replacing it on re-subscribe avoids duplicate pushes. */
      async set(deviceId: string, input: PushSubscriptionInput) {
        const [d] = await db.select({ id: device.id }).from(device).where(and(eq(device.id, deviceId), eq(device.userId, userId)));
        if (!d) return false;
        await db.delete(pushSubscription).where(eq(pushSubscription.deviceId, deviceId));
        await db.insert(pushSubscription).values({
          userId, deviceId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth,
        }).onConflictDoUpdate({
          target: pushSubscription.endpoint,
          set: { userId, deviceId, p256dh: input.keys.p256dh, auth: input.keys.auth },
        });
        return true;
      },
      clear: (deviceId: string) =>
        db.delete(pushSubscription).where(and(eq(pushSubscription.deviceId, deviceId), eq(pushSubscription.userId, userId))),
    },

    /**
     * Pending reminders across all profiles, for a device's local scheduler. Includes the last 24h so a
     * Mac that slept through a reminder still alerts on wake. Empty when the device has alerts off.
     */
    async upcomingFor(deviceId: string | undefined) {
      if (deviceId) {
        const [d] = await db.select().from(device).where(and(eq(device.id, deviceId), eq(device.userId, userId)));
        if (d && !d.notifyHere) return [];
      }
      const now = Date.now();
      return db.select({
        id: reminder.id,
        taskId: reminder.taskId,
        profileId: task.profileId,
        profileName: profile.name,
        title: task.title,
        fireAt: reminder.fireAt,
      }).from(reminder)
        .innerJoin(task, eq(reminder.taskId, task.id))
        .innerJoin(profile, eq(task.profileId, profile.id))
        .where(and(
          eq(profile.userId, userId), isNull(task.deletedAt), eq(task.status, "todo"), isNull(reminder.dismissedAt),
          gt(reminder.fireAt, new Date(now - 24 * 3600_000)), lt(reminder.fireAt, new Date(now + 7 * 24 * 3600_000)),
        ))
        .orderBy(asc(reminder.fireAt));
    },
  };
}
