import { useEffect, useRef, useState, type ReactNode } from "react";
import { REPEAT_PRESETS, describeRrule } from "@doer/core";
import { Popover } from "./Popover";

export interface DateTimeValue {
  /** Local date + time. For all-day values only the date part matters (time is 00:00). */
  date: Date | null;
  allDay: boolean;
  /** RRULE string (see REPEAT_PRESETS) or null for a one-off task. */
  rrule: string | null;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const withTime = (d: Date, h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Accepts "14:30", "9", "930", "9.30", "2pm", "11:15 am". */
export function parseTime(input: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?$/.exec(input.trim().toLowerCase());
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  if (match[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (match[3] === "pm" ? 12 : 0);
  }
  return h > 23 || m > 59 ? null : { h, m };
}

/** "Today 14:30", "Tomorrow", "Thu 22 Oct, 09:00". */
export function formatDue({ date, allDay }: Pick<DateTimeValue, "date" | "allDay">): string {
  if (!date) return "";
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(date).getTime() - today.getTime()) / DAY);
  const day =
    diff === 0 ? "Today"
    : diff === 1 ? "Tomorrow"
    : diff === -1 ? "Yesterday"
    : date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
  return allDay ? day : `${day}, ${hhmm(date)}`;
}

/** First sensible time for a freshly picked day: 09:00, or the next full hour if that's already past today. */
function defaultTimeFor(day: Date): Date {
  const nine = withTime(day, 9, 0);
  if (!sameDay(day, new Date()) || nine.getTime() > Date.now()) return nine;
  const next = new Date();
  return withTime(day, Math.min(next.getHours() + 1, 23), 0);
}

function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
}

const chip = "rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-fg transition hover:border-accent hover:text-accent";
const chipOn = "rounded-full border border-accent bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent";

/** Calendar + time body. Controlled; used inline (row editor) or inside a popover (add form). */
export function DateTimePanel({ value, onChange }: { value: DateTimeValue; onChange(v: DateTimeValue): void }) {
  const { date, allDay, rrule } = value;
  const [view, setView] = useState(() => startOfDay(date ?? new Date()));
  const [timeText, setTimeText] = useState(date && !allDay ? hhmm(date) : "");
  const today = new Date();

  // Keep the text box in step when the time changes from a chip, a day pick, or the all-day toggle.
  useEffect(() => setTimeText(date && !allDay ? hhmm(date) : ""), [date, allDay]);

  const pickDay = (d: Date) => {
    const t = date && !allDay ? date : defaultTimeFor(d);
    onChange({ date: allDay ? startOfDay(d) : withTime(d, t.getHours(), t.getMinutes()), allDay, rrule });
    setView(startOfDay(d));
  };
  const setTime = (h: number, m: number) =>
    onChange({ date: withTime(date ?? today, h, m), allDay: false, rrule });
  const commitTime = () => {
    const t = parseTime(timeText);
    if (t) setTime(t.h, t.m);
    else setTimeText(date && !allDay ? hhmm(date) : ""); // invalid: revert
  };

  const nextMonday = startOfDay(addDays(today, ((8 - today.getDay()) % 7) || 7));
  const presets: { label: string; day: Date }[] = [
    { label: "Today", day: startOfDay(today) },
    { label: "Tomorrow", day: startOfDay(addDays(today, 1)) },
    { label: "Next week", day: nextMonday },
  ];

  return (
    <div className="w-64 space-y-2 text-xs">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => pickDay(p.day)} className={date && sameDay(date, p.day) ? chipOn : chip}>
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            ‹
          </button>
          <span className="text-sm font-medium">{view.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-muted">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="py-0.5">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {monthGrid(view.getFullYear(), view.getMonth()).map((d) => {
            const selected = !!date && sameDay(d, date);
            const inMonth = d.getMonth() === view.getMonth();
            const isToday = sameDay(d, today);
            return (
              <button
                key={d.getTime()}
                type="button"
                onClick={() => pickDay(d)}
                className={`h-7 rounded-md text-xs transition ${
                  selected ? "bg-accent font-semibold text-accent-fg"
                  : `hover:bg-surface-2 ${inMonth ? "text-fg" : "text-muted/50"} ${isToday ? "ring-1 ring-accent/60" : ""}`
                }`}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-line pt-2">
        <label className="flex items-center justify-between">
          <span className="text-muted">All day</span>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) =>
              onChange({ date: e.target.checked ? startOfDay(date ?? today) : defaultTimeFor(date ?? today), allDay: e.target.checked, rrule })
            }
          />
        </label>
        {!allDay && (
          <div className="flex items-center gap-2">
            <input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              onBlur={commitTime}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitTime())}
              placeholder="14:30"
              aria-label="Time"
              className="w-16 rounded-lg border border-line bg-surface-2 px-2 py-1 text-center text-fg outline-none focus:border-accent"
            />
            <div className="flex flex-1 justify-end gap-1">
              {[[9, 0], [12, 0], [15, 0], [18, 0]].map(([h, m]) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setTime(h!, m!)}
                  className={`${date && date.getHours() === h && date.getMinutes() === m ? chipOn : chip} !px-1.5`}
                >
                  {h}:{pad(m!)}
                </button>
              ))}
            </div>
          </div>
        )}
        {date && (
          <label className="flex items-center justify-between">
            <span className="text-muted">Repeat</span>
            <select
              value={rrule ?? ""}
              onChange={(e) => onChange({ ...value, rrule: e.target.value || null })}
              aria-label="Repeat"
              className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-fg outline-none focus:border-accent"
            >
              {REPEAT_PRESETS.map((p) => <option key={p.label} value={p.rrule ?? ""}>{p.label}</option>)}
              {rrule && !REPEAT_PRESETS.some((p) => p.rrule === rrule) && <option value={rrule}>{describeRrule(rrule)}</option>}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/** Chip-style trigger that opens the picker as a dropdown; closes on outside click, Esc or "Done". */
export function DateTimeField({
  value,
  onChange,
  placeholder = "Due date",
}: {
  value: DateTimeValue;
  onChange(v: DateTimeValue): void;
  placeholder?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition ${
          value.date ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-surface text-muted hover:border-accent hover:text-fg"
        }`}
      >
        <span aria-hidden>📅</span>
        {value.date ? `${formatDue(value)}${value.rrule ? " · 🔁" : ""}` : placeholder}
        {value.date && (
          <span
            role="button"
            aria-label="Clear due date"
            onClick={(e) => { e.stopPropagation(); onChange({ date: null, allDay: false, rrule: null }); }}
            className="ml-1 rounded-full px-1 text-xs hover:bg-accent/20"
          >
            ✕
          </span>
        )}
      </button>
      {open && (
        <Popover anchor={trigger} onClose={() => setOpen(false)}>
          <DateTimePanel value={value} onChange={onChange} />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg">
              Done
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** Dropdown editor for an existing task: explicit Save / Clear / Cancel, nothing commits mid-pick. */
export function DueDropdown({
  anchor,
  initial,
  allDay,
  rrule,
  onSave,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  initial: string | null;
  allDay: boolean;
  rrule: string | null;
  onSave(due: { iso: string; allDay: boolean; rrule: string | null } | null): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<DateTimeValue>({ date: initial ? new Date(initial) : null, allDay, rrule });
  const btn = "rounded-md px-2.5 py-1 text-xs font-medium transition";
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <DateTimePanel value={draft} onChange={setDraft} />
      <div className="mt-2 flex items-center justify-between">
        {initial ? (
          <button onClick={() => { onSave(null); onClose(); }} className={`${btn} text-danger hover:bg-danger/10`}>Clear</button>
        ) : <span />}
        <div className="flex gap-1">
          <button onClick={onClose} className={`${btn} text-muted hover:bg-surface-2`}>Cancel</button>
          <button
            disabled={!draft.date}
            onClick={() => { if (draft.date) { onSave({ iso: draft.date.toISOString(), allDay: draft.allDay, rrule: draft.rrule }); onClose(); } }}
            className={`${btn} bg-accent text-accent-fg disabled:opacity-50`}
          >
            Save
          </button>
        </div>
      </div>
    </Popover>
  );
}
