import { RRule } from "rrule";
import { localParts, zonedToUtc } from "./reminders";

/** The repeat options the UI offers; tasks store the raw RRULE so richer rules can come later. */
export const REPEAT_PRESETS: { label: string; rrule: string | null }[] = [
  { label: "Doesn't repeat", rrule: null },
  { label: "Every day", rrule: "FREQ=DAILY" },
  { label: "Every weekday", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Every week", rrule: "FREQ=WEEKLY" },
  { label: "Every month", rrule: "FREQ=MONTHLY" },
  { label: "Every year", rrule: "FREQ=YEARLY" },
];

export function isValidRrule(rule: string): boolean {
  try {
    return RRule.parseString(rule).freq !== undefined;
  } catch {
    return false;
  }
}

export const describeRrule = (rule: string | null) =>
  rule ? (REPEAT_PRESETS.find((p) => p.rrule === rule)?.label ?? "Custom repeat") : null;

// Recurrence is expanded in "floating" time: the wall clock in `tz` is mapped onto UTC fields, the
// rule runs there, and the result is mapped back. That keeps 09:00 at 09:00 across DST changes.
const toFloating = (d: Date, tz: string) => {
  const l = localParts(d, tz);
  return new Date(Date.UTC(l.y, l.m - 1, l.d, l.h, l.min));
};
const fromFloating = (f: Date, tz: string) =>
  zonedToUtc(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), tz);

/**
 * The occurrence after `dueAt` (the series is re-anchored on the current occurrence each time it's
 * completed), or null when the rule has run out. Don't use COUNT in rules: re-anchoring restarts it.
 */
export function nextOccurrence(o: { dueAt: Date; rrule: string; tz?: string | null }): Date | null {
  const tz = o.tz || "UTC";
  const start = toFloating(o.dueAt, tz);
  const next = new RRule({ ...RRule.parseString(o.rrule), dtstart: start }).after(start, false);
  return next ? fromFloating(next, tz) : null;
}
