// Needs a real database: node --env-file=.dev.vars node_modules/vitest/vitest.mjs run calendar-mirror.int
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileMirrors } from "./calendar-mirror";
import { getDb } from "./db/client";
import { calendar, calendarAccount, calendarEvent, profile, task, taskCalendarLink, user } from "./db/schema";
import { GoogleNotFoundError, type GoogleCalendar, type GoogleEventBody } from "./google";
import { withProfile } from "./with-profile";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

/** A Google that records what it was asked to do. */
function fakeGoogle() {
  const events = new Map<string, GoogleEventBody & { id: string }>();
  const log: string[] = [];
  let n = 0;
  const g = {
    insertEvent: async (cal: string, body: GoogleEventBody) => {
      const id = `ev${++n}`;
      events.set(`${cal}/${id}`, { ...body, id });
      log.push(`insert ${cal}/${id} ${body.summary}`);
      return { id, etag: `"e${n}"` };
    },
    patchEvent: async (cal: string, id: string, body: GoogleEventBody) => {
      if (!events.has(`${cal}/${id}`)) throw new GoogleNotFoundError("nf");
      events.set(`${cal}/${id}`, { ...body, id });
      log.push(`patch ${cal}/${id} ${body.summary}`);
      return { id, etag: `"p${++n}"` };
    },
    deleteEvent: async (cal: string, id: string) => {
      events.delete(`${cal}/${id}`);
      log.push(`delete ${cal}/${id}`);
    },
  } as unknown as GoogleCalendar;
  return { g, events, log };
}

d("mirroring tasks to Google (real DB, fake Google)", () => {
  const db = getDb(url ?? "postgres://x");
  const uid = `inttest-${crypto.randomUUID()}`;
  let pid = "", calId = "", cal2Id = "";
  const fake = fakeGoogle();
  const run = () => reconcileMirrors(db, async () => fake.g, { profileId: pid });
  const mk = async (title: string, extra: Partial<typeof task.$inferInsert> = {}) =>
    (await db.insert(task).values({ profileId: pid, title, dueAt: new Date("2030-01-01T10:00:00Z"), ...extra }).returning())[0]!;
  const link = async (taskId: string) => (await db.select().from(taskCalendarLink).where(eq(taskCalendarLink.taskId, taskId)))[0];

  beforeAll(async () => {
    await db.insert(user).values({ id: uid, name: "t", email: `${uid}@example.com` });
    pid = (await db.insert(profile).values({ userId: uid, name: "P", kind: "private" }).returning())[0]!.id;
    const a = (await db.insert(calendarAccount).values({ profileId: pid, provider: "google", externalEmail: "x@gmail.com", refreshTokenEnc: "e", scopes: "s" }).returning())[0]!;
    calId = (await db.insert(calendar).values({ accountId: a.id, externalId: "primary", name: "Main", selected: true, writable: true, isWriteTarget: true }).returning())[0]!.id;
    cal2Id = (await db.insert(calendar).values({ accountId: a.id, externalId: "other", name: "Other", selected: true, writable: true }).returning())[0]!.id;
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, uid));
  });

  it("does nothing while mirroring is off", async () => {
    await mk("Off");
    expect(await run()).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(fake.log).toEqual([]);
  });

  it("creates events for timed tasks once mirroring is on (and skips untimed / opted-out ones)", async () => {
    const s = (await withProfile(db, uid, pid))!;
    await s.updateSettings({ mirrorTasks: true });
    await mk("No time", { dueAt: null });
    await mk("Opted out", { mirror: false });
    const r = await run();
    expect(r.created).toBe(1); // only "Off" qualifies
    expect(fake.log[0]).toMatch(/^insert primary\/ev1 Off$/);
    expect(await run()).toMatchObject({ created: 0, updated: 0, deleted: 0 }); // idempotent
  });

  it("a per-task override mirrors even when the profile default is off", async () => {
    const s = (await withProfile(db, uid, pid))!;
    await s.updateSettings({ mirrorTasks: false });
    const t = await mk("Forced", { mirror: true });
    await run();
    expect(await link(t.id)).toBeTruthy();
    // and turning the profile default off removes the others' events but keeps the forced one
    const r2 = await run();
    expect(r2.errors).toBe(0);
    await s.updateSettings({ mirrorTasks: true });
  });

  it("pushes edits, marks completion with ✓ and keeps the event", async () => {
    const t = await mk("Write report");
    await run();
    const before = fake.log.length;
    await db.update(task).set({ title: "Write the report", updatedAt: new Date(Date.now() + 1000) }).where(eq(task.id, t.id));
    await run();
    expect(fake.log.slice(before)).toEqual([expect.stringMatching(/^patch primary\/ev\d+ Write the report$/)]);
    await db.update(task).set({ status: "done", updatedAt: new Date(Date.now() + 2000) }).where(eq(task.id, t.id));
    await run();
    expect(fake.log.at(-1)).toMatch(/^patch .* ✓ Write the report$/);
    expect(await link(t.id)).toBeTruthy();
  });

  it("deleting a task deletes its event and link", async () => {
    const t = await mk("Temporary");
    await run();
    const l = (await link(t.id))!;
    const s = (await withProfile(db, uid, pid))!;
    await s.tasks.remove(t.id);
    await run();
    expect(fake.log.at(-1)).toBe(`delete primary/${l.externalEventId}`);
    expect(await link(t.id)).toBeUndefined();
  });

  it("clearing the due date, or opting a task out, removes the event", async () => {
    const t = await mk("Unschedule me");
    await run();
    await db.update(task).set({ dueAt: null, updatedAt: new Date(Date.now() + 1000) }).where(eq(task.id, t.id));
    await run();
    expect(await link(t.id)).toBeUndefined();
    const u = await mk("Opt me out");
    await run();
    await db.update(task).set({ mirror: false, updatedAt: new Date(Date.now() + 1000) }).where(eq(task.id, u.id));
    await run();
    expect(await link(u.id)).toBeUndefined();
  });

  it("recreates an event that was deleted in Google", async () => {
    const t = await mk("Gets deleted remotely");
    await run();
    const l = (await link(t.id))!;
    fake.events.delete(`primary/${l.externalEventId}`);
    await db.update(task).set({ title: "Gets deleted remotely!", updatedAt: new Date(Date.now() + 1000) }).where(eq(task.id, t.id));
    await run();
    const l2 = (await link(t.id))!;
    expect(l2.externalEventId).not.toBe(l.externalEventId);
    expect(fake.events.has(`primary/${l2.externalEventId}`)).toBe(true);
  });

  it("moves events when the write target changes", async () => {
    const t = await mk("Mover");
    await run();
    const s = (await withProfile(db, uid, pid))!;
    await s.calendars.updateCalendar(cal2Id, { isWriteTarget: true });
    await run();
    const l = (await link(t.id))!;
    expect(l.calendarId).toBe(cal2Id);
    expect(fake.events.has(`other/${l.externalEventId}`)).toBe(true);
    await s.calendars.updateCalendar(calId, { isWriteTarget: true });
  });

  it("hides our own mirrored events from the imported-events overlay", async () => {
    const s = (await withProfile(db, uid, pid))!;
    await db.insert(calendarEvent).values([
      { calendarId: calId, externalId: "mine", title: "Mirrored", startAt: new Date("2030-01-01T10:00:00Z"), endAt: new Date("2030-01-01T10:30:00Z"), raw: { extendedProperties: { private: { doerTaskId: "x" } } } },
      { calendarId: calId, externalId: "theirs", title: "Real meeting", startAt: new Date("2030-01-01T11:00:00Z"), endAt: new Date("2030-01-01T12:00:00Z"), raw: {} },
    ]);
    const events = await s.calendars.events(new Date("2029-12-31T00:00:00Z"), new Date("2030-01-03T00:00:00Z"));
    expect(events.map((e) => e.title)).toEqual(["Real meeting"]);
  });
});
