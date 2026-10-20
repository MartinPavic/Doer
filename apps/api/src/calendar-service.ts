import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { syncCalendar } from "./calendar-sync";
import { decryptToken, decryptTokenRotating, encryptToken } from "./crypto";
import type { Db } from "./db/client";
import { calendar, calendarAccount, calendarEvent } from "./db/schema";
import { GoogleAuthError, googleCalendar, refreshAccessToken, type GoogleCalendar, type GoogleCalendarListEntry, type GoogleEnv } from "./google";

export type CalendarEnv = GoogleEnv & { TOKEN_ENC_KEY?: string; TOKEN_ENC_KEY_PREVIOUS?: string };

const SYNC_EVERY_MS = 5 * 60_000;
const isWritable = (c: GoogleCalendarListEntry) => c.accessRole === "owner" || c.accessRole === "writer";

/** Calendar-account operations for ONE profile. Only reachable through `withProfile(...).calendars`. */
export function calendarsFor(db: Db, profileId: string) {
  const ownedAccount = (id: string) => and(eq(calendarAccount.id, id), eq(calendarAccount.profileId, profileId));
  const profileAccounts = db.select({ id: calendarAccount.id }).from(calendarAccount).where(eq(calendarAccount.profileId, profileId));

  return {
    /** Accounts with their calendars. Never includes tokens. */
    async accounts() {
      const accounts = await db.select({
        id: calendarAccount.id, provider: calendarAccount.provider, email: calendarAccount.externalEmail, status: calendarAccount.status,
      }).from(calendarAccount).where(eq(calendarAccount.profileId, profileId)).orderBy(asc(calendarAccount.createdAt));
      if (accounts.length === 0) return [];
      const cals = await db.select({
        id: calendar.id, accountId: calendar.accountId, name: calendar.name, color: calendar.color,
        selected: calendar.selected, isWriteTarget: calendar.isWriteTarget, writable: calendar.writable, lastSyncedAt: calendar.lastSyncedAt,
      }).from(calendar).where(inArray(calendar.accountId, accounts.map((a) => a.id))).orderBy(asc(calendar.name));
      return accounts.map((a) => ({ ...a, calendars: cals.filter((c) => c.accountId === a.id) }));
    },

    /** Stores (or re-authorises) an account and refreshes its calendar list. The primary calendar starts selected. */
    async saveGoogleAccount(o: { email: string; refreshTokenEnc: string; scopes: string; calendars: GoogleCalendarListEntry[] }) {
      const [account] = await db.insert(calendarAccount).values({
        profileId, provider: "google", externalEmail: o.email, refreshTokenEnc: o.refreshTokenEnc, scopes: o.scopes,
      }).onConflictDoUpdate({
        target: [calendarAccount.profileId, calendarAccount.provider, calendarAccount.externalEmail],
        set: { refreshTokenEnc: o.refreshTokenEnc, scopes: o.scopes, status: "active" },
      }).returning();
      for (const c of o.calendars) {
        await db.insert(calendar).values({
          accountId: account!.id, externalId: c.id, name: c.summary, color: c.backgroundColor ?? null, selected: !!c.primary,
          writable: isWritable(c),
        }).onConflictDoUpdate({ target: [calendar.accountId, calendar.externalId], set: { name: c.summary, color: c.backgroundColor ?? null, writable: isWritable(c) } });
      }
      return account!;
    },

    async updateCalendar(id: string, patch: { selected?: boolean; isWriteTarget?: boolean }) {
      const [owned] = await db.select({ id: calendar.id }).from(calendar).where(and(eq(calendar.id, id), inArray(calendar.accountId, profileAccounts)));
      if (!owned) return undefined;
      if (patch.isWriteTarget) {
        await db.update(calendar).set({ isWriteTarget: false }).where(inArray(calendar.accountId, profileAccounts)); // one target per profile
      }
      const [c] = await db.update(calendar).set(patch).where(eq(calendar.id, id)).returning();
      return c;
    },

    /** Deletes the account and all cached events; returns the encrypted token so the caller can revoke it. */
    async disconnect(accountId: string) {
      const [a] = await db.delete(calendarAccount).where(ownedAccount(accountId)).returning({ token: calendarAccount.refreshTokenEnc });
      return a?.token;
    },

    /** Events of selected calendars overlapping [from, to). */
    async events(from: Date, to: Date) {
      return db.select({
        id: calendarEvent.id, calendarId: calendarEvent.calendarId, title: calendarEvent.title, startAt: calendarEvent.startAt,
        endAt: calendarEvent.endAt, allDay: calendarEvent.allDay, color: calendar.color,
        link: sql<string | null>`${calendarEvent.raw}->>'htmlLink'`,
      }).from(calendarEvent)
        .innerJoin(calendar, eq(calendarEvent.calendarId, calendar.id))
        .where(and(
          inArray(calendar.accountId, profileAccounts), eq(calendar.selected, true), isNull(calendarEvent.deletedAt),
          // Events Doer itself mirrored out would otherwise show twice (once as the task, once as the event).
          sql`${calendarEvent.raw}->'extendedProperties'->'private'->>'doerTaskId' is null`,
          lt(calendarEvent.startAt, to), or(gte(calendarEvent.endAt, from), and(isNull(calendarEvent.endAt), gte(calendarEvent.startAt, from))),
        )).orderBy(asc(calendarEvent.startAt));
    },

    /** Syncs this profile's selected calendars right now. */
    syncNow: (env: CalendarEnv) => syncAccounts(db, env, eq(calendarAccount.profileId, profileId), true),
  };
}

/** A Google client for an account: decrypts its refresh token and trades it for an access token. */
export const googleClientFor = (env: CalendarEnv) => async (acct: typeof calendarAccount.$inferSelect): Promise<GoogleCalendar> => {
  if (!env.TOKEN_ENC_KEY) throw new Error("TOKEN_ENC_KEY is not set");
  return googleCalendar(await refreshAccessToken(env, await decryptToken(acct.refreshTokenEnc, env.TOKEN_ENC_KEY, env.TOKEN_ENC_KEY_PREVIOUS)));
};

/** Picks up renamed/new calendars and access-role changes (called on manual sync; new calendars start unselected). */
async function refreshCalendarList(db: Db, google: GoogleCalendar, accountId: string) {
  for (const c of await google.listCalendars()) {
    await db.insert(calendar).values({
      accountId, externalId: c.id, name: c.summary, color: c.backgroundColor ?? null, selected: false, writable: isWritable(c),
    }).onConflictDoUpdate({
      target: [calendar.accountId, calendar.externalId],
      set: { name: c.summary, color: c.backgroundColor ?? null, writable: isWritable(c) },
    });
  }
}

/** Cron: sync selected calendars that haven't been synced for a while (a few per run, oldest first). */
export const syncDueCalendars = (db: Db, env: CalendarEnv) => syncAccounts(db, env, undefined, false);

async function syncAccounts(db: Db, env: CalendarEnv, where: ReturnType<typeof eq> | undefined, force: boolean) {
  if (!env.TOKEN_ENC_KEY || !env.GOOGLE_CLIENT_ID) return { synced: 0, errors: 0 };
  const stale = new Date(Date.now() - SYNC_EVERY_MS);
  const rows = await db.select({ cal: calendar, acct: calendarAccount }).from(calendar)
    .innerJoin(calendarAccount, eq(calendar.accountId, calendarAccount.id))
    .where(and(
      eq(calendar.selected, true), eq(calendarAccount.status, "active"), eq(calendarAccount.provider, "google"), where,
      force ? undefined : or(isNull(calendar.lastSyncedAt), lt(calendar.lastSyncedAt, stale)),
    ))
    .orderBy(sql`${calendar.lastSyncedAt} asc nulls first`)
    .limit(force ? 50 : 6);

  let synced = 0, errors = 0;
  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) byAccount.set(r.acct.id, [...(byAccount.get(r.acct.id) ?? []), r]);
  for (const group of byAccount.values()) {
    const acct = group[0]!.acct;
    try {
      const access = await refreshAccessToken(env, await decryptToken(acct.refreshTokenEnc, env.TOKEN_ENC_KEY, env.TOKEN_ENC_KEY_PREVIOUS));
      const google = googleCalendar(access);
      if (force) await refreshCalendarList(db, google, acct.id);
      for (const { cal } of group) {
        try {
          await syncCalendar(db, google, cal);
          synced++;
        } catch (e) {
          if (e instanceof GoogleAuthError) throw e;
          errors++;
          console.error("[calendar sync]", cal.id, e);
        }
      }
    } catch (e) {
      errors++;
      if (e instanceof GoogleAuthError) await db.update(calendarAccount).set({ status: "reconnect" }).where(eq(calendarAccount.id, acct.id));
      else console.error("[calendar sync] account", acct.id, e);
    }
  }
  return { synced, errors };
}

/**
 * Re-encrypts refresh tokens that are still under the previous key (a few per run). A no-op unless
 * TOKEN_ENC_KEY_PREVIOUS is set, so normal operation pays nothing for it.
 */
export async function rotateTokenKeys(db: Db, env: CalendarEnv, limit = 20): Promise<number> {
  if (!env.TOKEN_ENC_KEY || !env.TOKEN_ENC_KEY_PREVIOUS) return 0;
  let rotated = 0;
  for (const acct of await db.select({ id: calendarAccount.id, token: calendarAccount.refreshTokenEnc }).from(calendarAccount)) {
    if (rotated >= limit) break;
    try {
      const { plain, usedPrevious } = await decryptTokenRotating(acct.token, env.TOKEN_ENC_KEY, env.TOKEN_ENC_KEY_PREVIOUS);
      if (!usedPrevious) continue;
      await db.update(calendarAccount).set({ refreshTokenEnc: await encryptToken(plain, env.TOKEN_ENC_KEY) }).where(eq(calendarAccount.id, acct.id));
      rotated++;
    } catch (e) {
      console.error("[key rotation] account", acct.id, "can't be decrypted with either key", e); // needs the user to reconnect
    }
  }
  return rotated;
}
