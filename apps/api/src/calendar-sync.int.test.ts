// Integration test against a real database (the dev Neon branch). Skipped unless DATABASE_URL is set:
//   node --env-file=.dev.vars node_modules/vitest/vitest.mjs run calendar-sync.int
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syncCalendar } from "./calendar-sync";
import { getDb } from "./db/client";
import { calendar, calendarAccount, calendarEvent, profile, user } from "./db/schema";
import { GoogleGoneError, type EventsPage, type GoogleCalendar } from "./google";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d("syncCalendar (real DB, fake Google)", () => {
  const db = getDb(url ?? "postgres://x");
  const uid = `inttest-${crypto.randomUUID()}`;
  let calId = "";

  beforeAll(async () => {
    await db.insert(user).values({ id: uid, name: "t", email: `${uid}@example.com` });
    const [p] = await db.insert(profile).values({ userId: uid, name: "P", kind: "private" }).returning();
    const [a] = await db.insert(calendarAccount).values({ profileId: p!.id, provider: "google", externalEmail: "x@gmail.com", refreshTokenEnc: "enc", scopes: "s" }).returning();
    const [c] = await db.insert(calendar).values({ accountId: a!.id, externalId: "primary", name: "Main", selected: true }).returning();
    calId = c!.id;
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, uid)); // cascades to everything above
  });

  const fake = (pages: Array<EventsPage | Error>, seen: Array<{ syncToken?: string }> = []): GoogleCalendar =>
    ({
      listCalendars: async () => [],
      listEvents: async (_id: string, o: { syncToken?: string }) => {
        seen.push({ syncToken: o.syncToken });
        const next = pages.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    }) as unknown as GoogleCalendar;

  const load = async () => (await db.select().from(calendar).where(eq(calendar.id, calId)))[0]!;
  const titles = async () => (await db.select().from(calendarEvent).where(eq(calendarEvent.calendarId, calId))).map((e) => e.title).sort();
  const ev = (id: string, summary: string, extra = {}) => ({ id, summary, etag: `"${summary}"`, start: { dateTime: "2026-10-21T09:00:00Z" }, end: { dateTime: "2026-10-21T10:00:00Z" }, ...extra });

  it("full sync across pages stores events and the sync token", async () => {
    const seen: Array<{ syncToken?: string }> = [];
    const r = await syncCalendar(db, fake([{ items: [ev("1", "One"), ev("2", "Two")], nextPageToken: "p2" }, { items: [ev("3", "Three", { start: { date: "2026-10-22" }, end: { date: "2026-10-23" } })], nextSyncToken: "S1" }], seen), await load());
    expect(r).toMatchObject({ upserted: 3, full: true });
    expect(await titles()).toEqual(["One", "Three", "Two"]);
    expect((await load()).syncToken).toBe("S1");
    expect(seen[0]!.syncToken).toBeUndefined();
  });

  it("incremental sync applies updates and cancellations using the token", async () => {
    const seen: Array<{ syncToken?: string }> = [];
    const r = await syncCalendar(db, fake([{ items: [ev("1", "One (renamed)"), { id: "2", status: "cancelled" }, ev("4", "Four")], nextSyncToken: "S2" }], seen), await load());
    expect(seen[0]!.syncToken).toBe("S1");
    expect(r).toMatchObject({ upserted: 2, removed: 1, full: false });
    expect(await titles()).toEqual(["Four", "One (renamed)", "Three"]);
    expect((await load()).syncToken).toBe("S2");
  });

  it("a 410 wipes the cache and falls back to a full resync", async () => {
    const seen: Array<{ syncToken?: string }> = [];
    const r = await syncCalendar(db, fake([new GoogleGoneError("gone"), { items: [ev("9", "Fresh")], nextSyncToken: "S3" }], seen), await load());
    expect(seen.map((s) => s.syncToken)).toEqual(["S2", undefined]);
    expect(r.full).toBe(true);
    expect(await titles()).toEqual(["Fresh"]);
    expect((await load()).syncToken).toBe("S3");
  });

  it("is idempotent for repeated events", async () => {
    await syncCalendar(db, fake([{ items: [ev("9", "Fresh")], nextSyncToken: "S4" }]), await load());
    expect(await titles()).toEqual(["Fresh"]);
  });
});
