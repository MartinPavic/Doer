// Needs a real database: node --env-file=.dev.vars node_modules/vitest/vitest.mjs run calendar-service.int
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withProfile } from "./with-profile";
import { getDb } from "./db/client";
import { calendar, calendarEvent, profile, user } from "./db/schema";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d("calendar accounts (real DB)", () => {
  const db = getDb(url ?? "postgres://x");
  const a = `inttest-${crypto.randomUUID()}`;
  const b = `inttest-${crypto.randomUUID()}`;
  let pa = "", pb = "";

  beforeAll(async () => {
    await db.insert(user).values([{ id: a, name: "a", email: `${a}@example.com` }, { id: b, name: "b", email: `${b}@example.com` }]);
    pa = (await db.insert(profile).values({ userId: a, name: "A", kind: "work" }).returning())[0]!.id;
    pb = (await db.insert(profile).values({ userId: b, name: "B", kind: "work" }).returning())[0]!.id;
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, a));
    await db.delete(user).where(eq(user.id, b));
  });

  const cals = [
    { id: "primary", summary: "Main", primary: true, backgroundColor: "#16a765", accessRole: "owner" },
    { id: "team@group", summary: "Team", accessRole: "reader" },
  ];

  it("saves an account, selects only the primary calendar, never exposes the token", async () => {
    const s = (await withProfile(db, a, pa))!;
    await s.calendars.saveGoogleAccount({ email: "me@gmail.com", refreshTokenEnc: "SECRET-ENC", scopes: "s", calendars: cals });
    const accounts = await s.calendars.accounts();
    expect(accounts).toHaveLength(1);
    expect(JSON.stringify(accounts)).not.toContain("SECRET-ENC");
    expect(accounts[0]!.calendars.map((c) => [c.name, c.selected])).toEqual([["Main", true], ["Team", false]]);
  });

  it("re-connecting the same account updates it instead of duplicating, and keeps the user's selection", async () => {
    const s = (await withProfile(db, a, pa))!;
    const team = (await s.calendars.accounts())[0]!.calendars.find((c) => c.name === "Team")!;
    await s.calendars.updateCalendar(team.id, { selected: true });
    await s.calendars.saveGoogleAccount({ email: "me@gmail.com", refreshTokenEnc: "NEW", scopes: "s", calendars: [{ ...cals[1]!, summary: "Team (renamed)" }, cals[0]!] });
    const accounts = await s.calendars.accounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.calendars.find((c) => c.name === "Team (renamed)")!.selected).toBe(true);
  });

  it("allows only one write target per profile", async () => {
    const s = (await withProfile(db, a, pa))!;
    const [c1, c2] = (await s.calendars.accounts())[0]!.calendars;
    await s.calendars.updateCalendar(c1!.id, { isWriteTarget: true });
    await s.calendars.updateCalendar(c2!.id, { isWriteTarget: true });
    const after = (await s.calendars.accounts())[0]!.calendars;
    expect(after.filter((c) => c.isWriteTarget).map((c) => c.id)).toEqual([c2!.id]);
  });

  it("returns only events of selected calendars inside the window", async () => {
    const s = (await withProfile(db, a, pa))!;
    const [c1, c2] = (await s.calendars.accounts())[0]!.calendars;
    const ev = (calendarId: string, externalId: string, startAt: string, title: string) =>
      ({ calendarId, externalId, title, startAt: new Date(startAt), endAt: new Date(new Date(startAt).getTime() + 3600_000), allDay: false, raw: { htmlLink: "https://g/e" } });
    await db.insert(calendarEvent).values([
      ev(c1!.id, "in", "2026-10-21T10:00:00Z", "Inside"), ev(c1!.id, "out", "2026-12-01T10:00:00Z", "Outside"), ev(c2!.id, "in2", "2026-10-21T11:00:00Z", "Team thing"),
    ]);
    await s.calendars.updateCalendar(c2!.id, { selected: false });
    const events = await s.calendars.events(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(events.map((e) => e.title)).toEqual(["Inside"]);
    expect(events[0]!.link).toBe("https://g/e");
  });

  it("is isolated between users", async () => {
    const other = (await withProfile(db, b, pb))!;
    expect(await other.calendars.accounts()).toEqual([]);
    expect(await withProfile(db, b, pa)).toBeUndefined(); // can't even open someone else's profile
    const [victim] = (await (await withProfile(db, a, pa))!.calendars.accounts())[0]!.calendars;
    expect(await other.calendars.updateCalendar(victim!.id, { selected: false })).toBeUndefined();
    expect(await other.calendars.disconnect((await (await withProfile(db, a, pa))!.calendars.accounts())[0]!.id)).toBeUndefined();
  });

  it("disconnect removes the account, its calendars and cached events", async () => {
    const s = (await withProfile(db, a, pa))!;
    const id = (await s.calendars.accounts())[0]!.id;
    expect(await s.calendars.disconnect(id)).toBe("NEW");
    expect(await s.calendars.accounts()).toEqual([]);
    expect(await db.select().from(calendar).where(eq(calendar.accountId, id))).toEqual([]); // cascaded away
  });
});
