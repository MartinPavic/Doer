import { describe, expect, it } from "vitest";
import { describeRrule, isValidRrule, nextOccurrence } from "./recurrence";
import { zonedToUtc } from "./reminders";

const ZG = "Europe/Zagreb";
const at = (y: number, m: number, d: number, h = 9, min = 0) => zonedToUtc(y, m, d, h, min, ZG);

describe("nextOccurrence", () => {
  it("daily keeps the wall-clock time across the DST change (Oct 25 2026)", () => {
    const next = nextOccurrence({ dueAt: at(2026, 10, 24), rrule: "FREQ=DAILY", tz: ZG })!;
    expect(next).toEqual(at(2026, 10, 25));
    const after = nextOccurrence({ dueAt: next, rrule: "FREQ=DAILY", tz: ZG })!;
    expect(after).toEqual(at(2026, 10, 26));
    // Oct 24 09:00 CEST -> Oct 25 09:00 CET is 25 real hours; the next day is a normal 24
    expect(next.getTime() - at(2026, 10, 24).getTime()).toBe(25 * 3600_000);
    expect(after.getTime() - next.getTime()).toBe(24 * 3600_000);
  });
  it("weekdays skip the weekend", () => {
    const friday = at(2026, 10, 23);
    expect(nextOccurrence({ dueAt: friday, rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", tz: ZG })).toEqual(at(2026, 10, 26));
  });
  it("weekly / monthly / yearly", () => {
    expect(nextOccurrence({ dueAt: at(2026, 10, 20), rrule: "FREQ=WEEKLY", tz: ZG })).toEqual(at(2026, 10, 27));
    expect(nextOccurrence({ dueAt: at(2026, 10, 20), rrule: "FREQ=MONTHLY", tz: ZG })).toEqual(at(2026, 11, 20));
    expect(nextOccurrence({ dueAt: at(2026, 10, 20), rrule: "FREQ=YEARLY", tz: ZG })).toEqual(at(2027, 10, 20));
  });
  it("honours INTERVAL", () => {
    expect(nextOccurrence({ dueAt: at(2026, 10, 20), rrule: "FREQ=WEEKLY;INTERVAL=2", tz: ZG })).toEqual(at(2026, 11, 3));
  });
  it("monthly on the 31st skips months without one", () => {
    expect(nextOccurrence({ dueAt: at(2026, 1, 31), rrule: "FREQ=MONTHLY", tz: ZG })).toEqual(at(2026, 3, 31));
  });
  it("returns null once UNTIL has passed", () => {
    expect(nextOccurrence({ dueAt: at(2026, 10, 20), rrule: "FREQ=DAILY;UNTIL=20261020T235959Z", tz: ZG })).toBeNull();
  });
  it("works for all-day tasks (local midnight) and without a tz", () => {
    expect(nextOccurrence({ dueAt: at(2026, 10, 24, 0), rrule: "FREQ=DAILY", tz: ZG })).toEqual(at(2026, 10, 25, 0));
    expect(nextOccurrence({ dueAt: new Date("2026-10-20T09:00:00Z"), rrule: "FREQ=DAILY" })).toEqual(new Date("2026-10-21T09:00:00Z"));
  });
});

describe("helpers", () => {
  it("validates rules", () => {
    expect(isValidRrule("FREQ=WEEKLY;BYDAY=MO")).toBe(true);
    expect(isValidRrule("nonsense")).toBe(false);
    expect(isValidRrule("")).toBe(false);
  });
  it("describes presets", () => {
    expect(describeRrule("FREQ=DAILY")).toBe("Every day");
    expect(describeRrule("FREQ=DAILY;INTERVAL=3")).toBe("Custom repeat");
    expect(describeRrule(null)).toBeNull();
  });
});
