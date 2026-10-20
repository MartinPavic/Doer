import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Per-profile quiet hours: reminders inside the window (or on weekends) are deferred, never dropped. */
export const quietHours = z.object({
  tz: z.string().max(64),
  /** Daily window, local time. May cross midnight (e.g. 18:00 → 09:00). start === end means no daily window. */
  start: hhmm,
  end: hhmm,
  weekends: z.boolean(),
});
export type QuietHours = z.infer<typeof quietHours>;

export const DEFAULT_ALL_DAY_TIME = "09:00";

interface Local { y: number; m: number; d: number; h: number; min: number; dow: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(date: Date, tz: string): Local {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, dow: DOW.indexOf(p.weekday!) };
}

/** The instant at which the wall clock in `tz` reads the given local date/time. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (t: number) => {
    const l = localParts(new Date(t), tz);
    return Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - t;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t); // second pass settles DST transitions
  return new Date(t);
}

const minutesOf = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

export function isQuiet(date: Date, q: QuietHours): boolean {
  const l = localParts(date, q.tz);
  if (q.weekends && (l.dow === 0 || l.dow === 6)) return true;
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  if (start === end) return false;
  const now = l.h * 60 + l.min;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Earliest instant at or after `date` that is outside quiet hours. */
export function deferOutOfQuiet(date: Date, q: QuietHours | null | undefined): Date {
  if (!q) return date;
  let t = date;
  // Each pass jumps to the next occurrence of the window end; weekends can chain a few passes.
  for (let i = 0; i < 10 && isQuiet(t, q); i++) {
    const l = localParts(t, q.tz);
    const endMin = minutesOf(q.end);
    let next = zonedToUtc(l.y, l.m, l.d, Math.floor(endMin / 60), endMin % 60, q.tz);
    if (next.getTime() <= t.getTime()) {
      // Today's end already passed (we're quiet because of the weekend): try tomorrow.
      const tomorrow = new Date(Date.UTC(l.y, l.m - 1, l.d) + 86_400_000);
      next = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), Math.floor(endMin / 60), endMin % 60, q.tz);
    }
    t = next;
  }
  return t;
}

export interface ReminderBase {
  dueAt: Date;
  allDay: boolean;
  /** The task's own timezone; falls back to UTC. */
  tz?: string | null;
  offsetMinutes: number;
  /** Local "HH:MM" for all-day tasks. */
  allDayTime?: string;
}

/** Undeferred moment a reminder wants to fire. */
export function baseFireAt(r: ReminderBase): Date {
  if (!r.allDay) return new Date(r.dueAt.getTime() - r.offsetMinutes * 60_000);
  const tz = r.tz || "UTC";
  const l = localParts(r.dueAt, tz);
  const t = r.allDayTime ?? DEFAULT_ALL_DAY_TIME;
  return zonedToUtc(l.y, l.m, l.d, Math.floor(minutesOf(t) / 60), minutesOf(t) % 60, tz);
}

export const fireAtFor = (r: ReminderBase, q: QuietHours | null | undefined) => deferOutOfQuiet(baseFireAt(r), q);
