import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "./db/client";
import { device, profile, pushSubscription, reminder, task } from "./db/schema";
import { sendPush, type PushEnv } from "./push";

const STALE_AFTER_MS = 24 * 3600_000;

/**
 * Cron entry (every minute): claim due reminders, then Web Push them to the owner's devices that
 * have alerts on. Claiming (setting fired_at in one UPDATE ... RETURNING) makes overlapping runs
 * safe. The desktop app doesn't depend on this: it reads fire_at itself and ignores fired_at.
 */
export async function dispatchDueReminders(db: Db, env: PushEnv, now = new Date()) {
  const liveTasks = db.select({ id: task.id }).from(task).where(and(eq(task.status, "todo"), isNull(task.deletedAt)));
  const claimed = await db.update(reminder).set({ firedAt: now })
    .where(and(isNull(reminder.firedAt), isNull(reminder.dismissedAt), lte(reminder.fireAt, now), inArray(reminder.taskId, liveTasks)))
    .returning({ id: reminder.id, taskId: reminder.taskId, fireAt: reminder.fireAt });
  // A long outage shouldn't replay old reminders as pushes; they remain visible as in-app alerts.
  const fresh = claimed.filter((r) => now.getTime() - r.fireAt.getTime() < STALE_AFTER_MS);
  if (fresh.length === 0) return { claimed: claimed.length, pushed: 0 };

  const rows = await db.select({
    reminderId: reminder.id, taskId: task.id, profileId: profile.id, userId: profile.userId,
    title: task.title, profileName: profile.name,
  }).from(reminder)
    .innerJoin(task, eq(reminder.taskId, task.id))
    .innerJoin(profile, eq(task.profileId, profile.id))
    .where(inArray(reminder.id, fresh.map((r) => r.id)));

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const subs = await db.select({ id: pushSubscription.id, userId: pushSubscription.userId, endpoint: pushSubscription.endpoint, p256dh: pushSubscription.p256dh, auth: pushSubscription.auth })
    .from(pushSubscription)
    .innerJoin(device, eq(pushSubscription.deviceId, device.id))
    .where(and(inArray(pushSubscription.userId, userIds), eq(device.notifyHere, true), eq(device.kind, "web")));

  const sends = rows.flatMap((r) =>
    subs.filter((s) => s.userId === r.userId).map(async (s) => {
      const result = await sendPush(env, s, {
        title: r.title, body: r.profileName, reminderId: r.reminderId, taskId: r.taskId, profileId: r.profileId,
      });
      return { subId: s.id, result };
    }),
  );
  const results = await Promise.all(sends);
  const gone = [...new Set(results.filter((x) => x.result === "gone").map((x) => x.subId))];
  if (gone.length) await db.delete(pushSubscription).where(inArray(pushSubscription.id, gone));
  return { claimed: claimed.length, pushed: results.filter((x) => x.result === "ok").length };
}

