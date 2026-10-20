import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { calendar, calendarEvent } from "./db/schema";
import { GoogleGoneError, type GoogleCalendar, type GoogleEvent } from "./google";

const PAST_DAYS = 90;
const FUTURE_DAYS = 365;
const DAY = 86_400_000;

type EventRow = typeof calendarEvent.$inferInsert;

/** Google event -> cached row, or null when the event was cancelled (deleted) at the source. */
export function mapGoogleEvent(calendarId: string, e: GoogleEvent): EventRow | "cancelled" | null {
  if (e.status === "cancelled") return "cancelled";
  const startRaw = e.start?.dateTime ?? e.start?.date;
  if (!startRaw) return null;
  const allDay = !e.start?.dateTime;
  const endRaw = e.end?.dateTime ?? e.end?.date;
  return {
    calendarId,
    externalId: e.id,
    etag: e.etag ?? null,
    title: e.summary?.trim() || "(No title)",
    // All-day dates are stored as UTC midnight of the calendar date; the client shows just the date.
    startAt: new Date(allDay ? `${startRaw}T00:00:00Z` : startRaw),
    endAt: endRaw ? new Date(allDay ? `${endRaw}T00:00:00Z` : endRaw) : null,
    allDay,
    rrule: null,
    raw: e,
  };
}

/**
 * Brings the cached events of one calendar up to date: a bounded full listing the first time (and after
 * a 410), then incremental `syncToken` deltas. Safe to run concurrently; it's idempotent per event.
 */
export async function syncCalendar(db: Db, google: GoogleCalendar, cal: typeof calendar.$inferSelect, now = new Date()) {
  let token = cal.syncToken ?? undefined;
  let result = { upserted: 0, removed: 0, full: !token };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!token) await db.delete(calendarEvent).where(eq(calendarEvent.calendarId, cal.id)); // full sync: start clean
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      result = { upserted: 0, removed: 0, full: !token };

      do {
        const page = await google.listEvents(cal.externalId, {
          syncToken: token,
          timeMin: new Date(now.getTime() - PAST_DAYS * DAY).toISOString(),
          timeMax: new Date(now.getTime() + FUTURE_DAYS * DAY).toISOString(),
          pageToken,
        });
        const rows: EventRow[] = [];
        const removed: string[] = [];
        for (const e of page.items) {
          const m = mapGoogleEvent(cal.id, e);
          if (m === "cancelled") removed.push(e.id);
          else if (m) rows.push(m);
        }
        if (removed.length) {
          await db.delete(calendarEvent).where(and(eq(calendarEvent.calendarId, cal.id), inArray(calendarEvent.externalId, removed)));
          result.removed += removed.length;
        }
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          await db.insert(calendarEvent).values(chunk).onConflictDoUpdate({
            target: [calendarEvent.calendarId, calendarEvent.externalId],
            set: {
              etag: sqlExcluded("etag"), title: sqlExcluded("title"), startAt: sqlExcluded("start_at"),
              endAt: sqlExcluded("end_at"), allDay: sqlExcluded("all_day"), raw: sqlExcluded("raw"),
            },
          });
        }
        result.upserted += rows.length;
        pageToken = page.nextPageToken;
        nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      } while (pageToken);

      await db.update(calendar).set({ syncToken: nextSyncToken ?? null, lastSyncedAt: now }).where(eq(calendar.id, cal.id));
      return result;
    } catch (e) {
      if (e instanceof GoogleGoneError && token) {
        token = undefined; // expired sync token: wipe and do one full resync
        await db.update(calendar).set({ syncToken: null }).where(eq(calendar.id, cal.id));
        continue;
      }
      throw e;
    }
  }
  return result;
}

const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`);
