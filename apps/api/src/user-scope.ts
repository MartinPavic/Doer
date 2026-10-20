import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import type { DeviceInput, PushSubscriptionInput } from "@doer/core/schemas";
import type { Db } from "./db/client";
import { device, profile, pushSubscription, reminder, task } from "./db/schema";

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
