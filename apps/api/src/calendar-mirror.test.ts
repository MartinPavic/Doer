import { describe, expect, it } from "vitest";
import { taskToEventBody } from "./calendar-mirror";
import type { task } from "./db/schema";

const base = {
  id: "t1", profileId: "p", parentId: null, title: "Pay rent", notes: null, status: "todo", priority: 0, startAt: null,
  dueAt: new Date("2026-10-21T10:00:00Z"), allDay: false, tz: "Europe/Zagreb", rrule: null, completedAt: null, mirror: null,
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
} as typeof task.$inferSelect;

describe("taskToEventBody", () => {
  it("a point-in-time task becomes a 30 minute event, tagged and without Google's own reminders", () => {
    const b = taskToEventBody(base);
    expect(b.start).toEqual({ dateTime: "2026-10-21T10:00:00.000Z", timeZone: "Europe/Zagreb" });
    expect(b.end?.dateTime).toBe("2026-10-21T10:30:00.000Z");
    expect(b.extendedProperties?.private.doerTaskId).toBe("t1");
    expect(b.reminders).toEqual({ useDefault: false });
    expect(b.summary).toBe("Pay rent");
  });
  it("a task with start and due spans that range", () => {
    const b = taskToEventBody({ ...base, startAt: new Date("2026-10-21T09:00:00Z") });
    expect(b.start?.dateTime).toBe("2026-10-21T09:00:00.000Z");
    expect(b.end?.dateTime).toBe("2026-10-21T10:00:00.000Z");
  });
  it("done tasks get a check mark in the title (the event is kept)", () => {
    expect(taskToEventBody({ ...base, status: "done" }).summary).toBe("✓ Pay rent");
  });
  it("all-day tasks use the local date in the task's timezone with an exclusive end", () => {
    // local midnight Oct 22 in Zagreb (CEST) = Oct 21 22:00Z; the UTC date would be wrong
    const b = taskToEventBody({ ...base, allDay: true, dueAt: new Date("2026-10-21T22:00:00Z") });
    expect(b.start).toEqual({ date: "2026-10-22" });
    expect(b.end).toEqual({ date: "2026-10-23" });
  });
  it("patch bodies null the other representation so timed <-> all-day switches work", () => {
    expect(taskToEventBody(base, true).start).toMatchObject({ date: null });
    expect(taskToEventBody({ ...base, allDay: true }, true).start).toMatchObject({ dateTime: null });
    expect(taskToEventBody(base, false).start).not.toHaveProperty("date");
  });
  it("includes notes", () => {
    expect(taskToEventBody({ ...base, notes: "bring card" }).description).toContain("bring card");
  });
});
