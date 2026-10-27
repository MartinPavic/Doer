import { useRef, useState, type FormEvent, type HTMLAttributes } from "react";
import {
  describeRrule, useCalendarAccounts, useReminders, useTaskMutations, useTasks, useUiState,
  type Profile, type Reminder, type Task, type TaskView,
} from "@doer/core";
import { DateTimeField, DueDropdown, formatDue, type DateTimeValue } from "./DateTimePicker";
import { NotesDropdown } from "./NotesDropdown";
import { REMINDER_OFFSETS } from "./reminder-options";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
];

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });


const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function TaskRow({
  task: t,
  reminder,
  onToggle,
  onDelete,
  onSetDue,
  onSetNotes,
  inCalendar,
  onSetInCalendar,
  dragProps,
  dragging,
  dropTarget,
}: {
  task: Task;
  reminder?: Reminder;
  onToggle(done: boolean): void;
  onDelete(): void;
  /** When provided, the row offers a date picker to (re)schedule the task. */
  onSetDue?(due: { iso: string; allDay: boolean; rrule: string | null } | null): void;
  /** When provided, the row shows a notes preview and lets the user edit the notes. */
  onSetNotes?(notes: string | null): void;
  /** When provided (profile has a writable Google calendar), a scheduled task can be toggled in/out of it. */
  inCalendar?: boolean;
  onSetInCalendar?(on: boolean): void;
  /** When provided, the row can be dragged to reorder (the list owns the drag state). */
  dragProps?: HTMLAttributes<HTMLLIElement>;
  dragging?: boolean;
  dropTarget?: boolean;
}) {
  const [editingDue, setEditingDue] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const dueButton = useRef<HTMLButtonElement>(null);
  const notesButton = useRef<HTMLButtonElement>(null);
  const firstNoteLine = t.notes?.split("\n").find((l) => l.trim())?.trim();
  const done = t.status === "done";
  const overdue = !done && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
  return (
    <li
      {...dragProps}
      className={`group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/60 ${dragProps ? "cursor-grab" : ""} ${dragging ? "opacity-40" : ""} ${dropTarget ? "bg-accent/15" : ""}`}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-[18px] cursor-pointer rounded"
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={titleExpanded}
          onClick={() => setTitleExpanded((expanded) => !expanded)}
          className={`block w-full text-left text-sm ${titleExpanded ? "whitespace-normal break-words" : "truncate"} ${done ? "text-muted line-through" : ""}`}
        >
          {t.title}
        </button>
        {firstNoteLine && (
          <p className="mt-0.5 truncate text-xs italic text-muted" title={t.notes ?? undefined}>
            📝 {firstNoteLine}
          </p>
        )}
        {(t.dueAt || reminder || t.rrule) && (
          <p className={`mt-0.5 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
            {t.dueAt && <>{overdue ? "Overdue · " : ""}{t.allDay ? formatDue({ date: new Date(t.dueAt), allDay: true }) : fmt(t.dueAt)}</>}
            {t.rrule && <span title="Repeats"> · 🔁 {describeRrule(t.rrule)}</span>}
            {reminder && !reminder.firedAt && <span title="Reminder"> · 🔔 {fmtTime(reminder.fireAt)}</span>}
          </p>
        )}
      </div>
      {onSetNotes && (
        <button
          ref={notesButton}
          onClick={() => setEditingNotes((v) => !v)}
          aria-label={t.notes ? "Edit notes" : "Add notes"}
          className={`rounded-md px-1.5 text-muted transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100 ${editingNotes || t.notes ? "opacity-100" : "opacity-0"}`}
        >
          📝
        </button>
      )}
      {onSetDue && !done && (
        <button
          ref={dueButton}
          onClick={() => setEditingDue((v) => !v)}
          aria-label={t.dueAt ? "Change due date" : "Set due date"}
          className={`rounded-md px-1.5 text-muted transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100 ${editingDue ? "opacity-100" : "opacity-0"}`}
        >
          📅
        </button>
      )}
      {onSetInCalendar && t.dueAt && !done && (
        <button
          onClick={() => onSetInCalendar(!inCalendar)}
          aria-label={inCalendar ? "Remove from Google Calendar" : "Add to Google Calendar"}
          title={inCalendar ? "In Google Calendar (click to remove)" : "Add to Google Calendar"}
          className={`rounded-md px-1.5 text-muted transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100 ${inCalendar ? "bg-accent/15 opacity-100" : "opacity-0"}`}
        >
          🗓️
        </button>
      )}
      {editingNotes && onSetNotes && (
        <NotesDropdown anchor={notesButton} initial={t.notes} onSave={onSetNotes} onClose={() => setEditingNotes(false)} />
      )}
      {editingDue && onSetDue && (
        <DueDropdown
          anchor={dueButton}
          initial={t.dueAt}
          allDay={t.allDay}
          rrule={t.rrule}
          onSave={onSetDue}
          onClose={() => setEditingDue(false)}
        />
      )}
      <button
        onClick={onDelete}
        aria-label="Delete task"
        className="rounded-md px-1.5 text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
      >
        ✕
      </button>
    </li>
  );
}

export function TaskList({ profile }: { profile: Profile }) {
  const view = useUiState((s) => s.view);
  const setView = useUiState((s) => s.setView);
  const { data: tasks = [], isPending, error } = useTasks(profile.id, view);
  const { create, update, remove } = useTaskMutations(profile.id);
  const { data: reminders = [] } = useReminders(profile.id);
  const reminderByTask = new Map(reminders.map((r) => [r.taskId, r]));
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<DateTimeValue>({ date: null, allDay: false, rrule: null });
  const { data: accounts = [] } = useCalendarAccounts(profile.id);
  const canMirror = accounts.some((a) => a.calendars.some((c) => c.isWriteTarget && c.writable));
  const [toCalendarPick, setToCalendar] = useState<boolean | null>(null); // null = follow the profile default
  const toCalendar = toCalendarPick ?? profile.mirrorTasks;
  const [remind, setRemind] = useState<"default" | "none" | number>("default");

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const canReorder = view !== "done";

  /** Drops the dragged task into the target's slot and renumbers only the rows whose position changed. */
  function drop(targetId: string) {
    const from = tasks.findIndex((t) => t.id === dragId);
    const to = tasks.findIndex((t) => t.id === targetId);
    setDragId(null);
    setOverId(null);
    if (from < 0 || to < 0 || from === to) return;
    const order = tasks.slice();
    order.splice(to, 0, order.splice(from, 1)[0]!);
    order.forEach((o, i) => {
      if (o.sortOrder !== i + 1) update.mutate({ id: o.id, sortOrder: i + 1 });
    });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const dueAt = due.date?.toISOString();
    const allDay = due.allDay;
    create.mutate(
      {
        title,
        ...(dueAt && { dueAt, allDay, tz: localTz(), ...(due.rrule && { rrule: due.rrule }) }),
        // Only send an override when it differs from the profile's default.
        ...(dueAt && canMirror && toCalendar !== profile.mirrorTasks && { mirror: toCalendar }),
        ...(dueAt && remind !== "default" && { reminderOffset: remind === "none" ? null : remind }),
      },
      { onSuccess: () => { setTitle(""); setDue({ date: null, allDay: false, rrule: null }); setRemind("default"); setToCalendar(null); } },
    );
  }

  const field = "rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent";

  return (
    <div className="space-y-4">
      <nav className="flex gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              view === v.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <form onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Add a ${profile.name.toLowerCase()} task and press Enter…`}
          className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-fg shadow-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        {title.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DateTimeField value={due} onChange={setDue} />
            {due.date && canMirror && (
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={toCalendar} onChange={(e) => setToCalendar(e.target.checked)} />
                Google Calendar
              </label>
            )}
            {due.date && (
              <select
                value={String(remind)}
                onChange={(e) => setRemind(e.target.value === "default" || e.target.value === "none" ? e.target.value : Number(e.target.value))}
                aria-label="Reminder"
                className={field}
              >
                <option value="default">Default reminder</option>
                {!due.allDay && REMINDER_OFFSETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                <option value="none">No reminder</option>
              </select>
            )}
          </div>
        )}
      </form>

      {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error.message}</p>}

      {isPending ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line py-12 text-center">
          <p className="text-2xl">✨</p>
          <p className="mt-1 text-sm text-muted">Nothing here. Add a task above.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              dragging={dragId === t.id}
              dropTarget={!!dragId && overId === t.id && dragId !== t.id}
              dragProps={canReorder ? {
                draggable: true,
                onDragStart: (e) => { e.dataTransfer.effectAllowed = "move"; setDragId(t.id); },
                onDragOver: (e) => { if (dragId) { e.preventDefault(); setOverId(t.id); } },
                onDrop: (e) => { e.preventDefault(); drop(t.id); },
                onDragEnd: () => { setDragId(null); setOverId(null); },
              } : undefined}
              reminder={reminderByTask.get(t.id)}
              onToggle={(done) => update.mutate({ id: t.id, status: done ? "done" : "todo" })}
              onDelete={() => remove.mutate(t.id)}
              onSetNotes={(notes) => update.mutate({ id: t.id, notes })}
              inCalendar={t.mirror ?? profile.mirrorTasks}
              onSetInCalendar={canMirror ? (on) => update.mutate({ id: t.id, mirror: on }) : undefined}
              onSetDue={(due) =>
                update.mutate({ id: t.id, dueAt: due?.iso ?? null, allDay: due?.allDay ?? false, rrule: due?.rrule ?? null, tz: localTz() })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
