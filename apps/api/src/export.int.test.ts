// Needs a real database: node --env-file=.dev.vars node_modules/vitest/vitest.mjs run export.int
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "./db/client";
import { calendar, calendarAccount, profile, reminder, task, taskOccurrence, user } from "./db/schema";
import { forUser } from "./user-scope";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d("export (real DB)", () => {
  const db = getDb(url ?? "postgres://x");
  const a = `inttest-${crypto.randomUUID()}`;
  const b = `inttest-${crypto.randomUUID()}`;
  let pa = "";

  beforeAll(async () => {
    await db.insert(user).values([{ id: a, name: "Ann", email: `${a}@example.com` }, { id: b, name: "Bob", email: `${b}@example.com` }]);
    pa = (await db.insert(profile).values({ userId: a, name: "Work", kind: "work" }).returning())[0]!.id;
    const pb = (await db.insert(profile).values({ userId: b, name: "Bobs", kind: "work" }).returning())[0]!.id;
    const t1 = (await db.insert(task).values({ profileId: pa, title: "Mine", dueAt: new Date("2030-01-01T10:00:00Z"), rrule: "FREQ=DAILY" }).returning())[0]!;
    await db.insert(task).values({ profileId: pa, title: "Deleted", deletedAt: new Date() });
    await db.insert(task).values({ profileId: pb, title: "Bobs secret task" });
    await db.insert(taskOccurrence).values({ taskId: t1.id, occurrenceAt: new Date("2029-12-31T10:00:00Z") });
    await db.insert(reminder).values({ taskId: t1.id, offsetMinutes: 10, baseAt: new Date(), fireAt: new Date() });
    const acct = (await db.insert(calendarAccount).values({ profileId: pa, provider: "google", externalEmail: "ann@gmail.com", refreshTokenEnc: "TOP-SECRET-TOKEN", scopes: "s" }).returning())[0]!;
    await db.insert(calendar).values({ accountId: acct.id, externalId: "primary", name: "Main", selected: true });
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, a));
    await db.delete(user).where(eq(user.id, b));
  });

  it("contains the user's own data in a versioned, self-describing shape", async () => {
    const x = await forUser(db, a).exportAll();
    expect(x).toMatchObject({ app: "doer", formatVersion: 1, user: { email: `${a}@example.com`, name: "Ann" } });
    expect(x.profiles).toHaveLength(1);
    const p = x.profiles[0]!;
    expect(p.name).toBe("Work");
    expect(p.tasks.map((t) => t.title)).toEqual(["Mine"]); // soft-deleted tasks are excluded
    expect(p.tasks[0]!.completedOccurrences).toHaveLength(1);
    expect(p.tasks[0]!.reminders).toHaveLength(1);
    expect(p.calendarAccounts[0]).toMatchObject({ provider: "google", email: "ann@gmail.com", calendars: [{ name: "Main", selected: true }] });
  });

  it("never includes secrets or other users' data", async () => {
    const json = JSON.stringify(await forUser(db, a).exportAll());
    expect(json).not.toContain("TOP-SECRET-TOKEN");
    expect(json).not.toContain("refreshTokenEnc");
    expect(json).not.toContain("Bobs secret task");
    expect(json).not.toContain(b);
  });

  it("is empty-safe for a user with no tasks", async () => {
    const x = await forUser(db, b).exportAll();
    expect(x.profiles[0]!.tasks.map((t) => t.title)).toEqual(["Bobs secret task"]);
    await db.delete(task).where(eq(task.title, "Bobs secret task"));
    expect((await forUser(db, b).exportAll()).profiles[0]!.tasks).toEqual([]);
  });
});
