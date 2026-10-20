import { describe, expect, it } from "vitest";
import { baseFireAt, deferOutOfQuiet, fireAtFor, isQuiet, zonedToUtc, type QuietHours } from "./reminders";

const ZG = "Europe/Zagreb"; // CEST (UTC+2) until 2026-10-25, CET (UTC+1) after
const work: QuietHours = { tz: ZG, start: "18:00", end: "09:00", weekends: true };
const at = (iso: string) => new Date(iso);

describe("zonedToUtc", () => {
  it("handles summer and winter offsets", () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, ZG).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedToUtc(2026, 1, 1, 9, 0, ZG).toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });
  it("is correct across the spring-forward day", () => {
    // 2026-03-29: clocks jump 02:00 → 03:00 in Europe. 09:00 local is already CEST.
    expect(zonedToUtc(2026, 3, 29, 9, 0, ZG).toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(zonedToUtc(2026, 3, 28, 9, 0, ZG).toISOString()).toBe("2026-03-28T08:00:00.000Z");
  });
  it("works for a western zone", () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("isQuiet", () => {
  it("covers the overnight window", () => {
    expect(isQuiet(at("2026-10-21T17:00:00Z"), work)).toBe(true); // Wed 19:00 local
    expect(isQuiet(at("2026-10-21T05:00:00Z"), work)).toBe(true); // Wed 07:00 local
    expect(isQuiet(at("2026-10-21T10:00:00Z"), work)).toBe(false); // Wed 12:00 local
  });
  it("treats window end as exclusive and start as inclusive", () => {
    expect(isQuiet(at("2026-10-21T07:00:00Z"), work)).toBe(false); // exactly 09:00 CEST
    expect(isQuiet(at("2026-10-21T15:59:00Z"), work)).toBe(false); // 17:59 CEST
    expect(isQuiet(at("2026-10-21T16:00:00Z"), work)).toBe(true); // exactly 18:00 CEST
  });
  it("covers weekends all day", () => {
    expect(isQuiet(at("2026-10-24T10:00:00Z"), work)).toBe(true); // Saturday noon
    expect(isQuiet(at("2026-10-24T10:00:00Z"), { ...work, weekends: false })).toBe(false);
  });
  it("supports a same-day window", () => {
    const lunch: QuietHours = { tz: ZG, start: "12:00", end: "13:00", weekends: false };
    expect(isQuiet(at("2026-10-21T10:30:00Z"), lunch)).toBe(true); // 12:30 CEST
    expect(isQuiet(at("2026-10-21T11:00:00Z"), lunch)).toBe(false); // 13:00 CEST
  });
  it("start === end means no daily window", () => {
    expect(isQuiet(at("2026-10-21T17:00:00Z"), { ...work, start: "09:00", end: "09:00", weekends: false })).toBe(false);
  });
});

describe("deferOutOfQuiet", () => {
  it("leaves non-quiet times and null settings alone", () => {
    const t = at("2026-10-21T10:00:00Z");
    expect(deferOutOfQuiet(t, work)).toEqual(t);
    expect(deferOutOfQuiet(t, null)).toEqual(t);
  });
  it("evening reminder moves to next morning end of window", () => {
    // Wed 20:00 CEST → Thu 09:00 CEST = 07:00Z
    expect(deferOutOfQuiet(at("2026-10-21T18:00:00Z"), work).toISOString()).toBe("2026-10-22T07:00:00.000Z");
  });
  it("early-morning reminder moves to the same morning", () => {
    // Wed 08:00 CEST → Wed 09:00 CEST
    expect(deferOutOfQuiet(at("2026-10-21T06:00:00Z"), work).toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
  it("Friday evening skips the weekend to Monday morning", () => {
    // Fri 2026-10-23 19:00 CEST/CET → Mon 2026-10-26 09:00 (CET, after DST end on Oct 25)
    const out = deferOutOfQuiet(at("2026-10-23T17:00:00Z"), work);
    expect(out.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(isQuiet(out, work)).toBe(false);
  });
  it("Saturday noon goes to Monday", () => {
    expect(deferOutOfQuiet(at("2026-10-24T10:00:00Z"), work).toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
});

describe("baseFireAt / fireAtFor", () => {
  const due = at("2026-10-21T12:00:00Z");
  it("subtracts the offset for timed tasks", () => {
    expect(baseFireAt({ dueAt: due, allDay: false, offsetMinutes: 10 }).toISOString()).toBe("2026-10-21T11:50:00.000Z");
    expect(baseFireAt({ dueAt: due, allDay: false, offsetMinutes: 0 })).toEqual(due);
  });
  it("fires all-day tasks at 09:00 local on the due date", () => {
    // All-day tasks store their due date as local midnight.
    const dueMidnight = zonedToUtc(2026, 10, 21, 0, 0, ZG);
    const f = baseFireAt({ dueAt: dueMidnight, allDay: true, tz: ZG, offsetMinutes: 999 });
    expect(f).toEqual(zonedToUtc(2026, 10, 21, 9, 0, ZG));
  });
  it("honours a custom all-day time", () => {
    const dueMidnight = zonedToUtc(2026, 10, 21, 0, 0, ZG);
    expect(baseFireAt({ dueAt: dueMidnight, allDay: true, tz: ZG, offsetMinutes: 0, allDayTime: "07:30" }))
      .toEqual(zonedToUtc(2026, 10, 21, 7, 30, ZG));
  });
  it("applies quiet hours on top", () => {
    // due Wed 19:30 local, 10 min before → 19:20 is quiet → Thu 09:00
    const d = zonedToUtc(2026, 10, 21, 19, 30, ZG);
    expect(fireAtFor({ dueAt: d, allDay: false, offsetMinutes: 10 }, work)).toEqual(zonedToUtc(2026, 10, 22, 9, 0, ZG));
  });
});
