import { useRef, useState, type FormEvent } from "react";
import {
  useReminders, useTaskMutations, useTasks, useUiState,
  type Profile, type Reminder, type Task, type TaskView,
} from "@doer/core";
import { DateTimeField, DueDropdown, formatDue, type DateTimeValue } from "./DateTimePicker";
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
}: {
  task: Task;
  reminder?: Reminder;
  onToggle(done: boolean): void;
  onDelete(): void;
  /** When provided, the row offers a date picker to (re)schedule the task. */
  onSetDue?(due: { iso: string; allDay: boolean } | null): void;
}) {
  const [editingDue, setEditingDue] = useState(false);
  const dueButton = useRef<HTMLButtonElement>(null);
  const done = t.status === "done";
  const overdue = !done && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/60">
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-[18px] cursor-pointer rounded"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${done ? "text-muted line-through" : ""}`}>{t.title}</p>
        {(t.dueAt || reminder) && (
          <p className={`mt-0.5 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
            {t.dueAt && <>{overdue ? "Overdue · " : ""}{t.allDay ? formatDue({ date: new Date(t.dueAt), allDay: true }) : fmt(t.dueAt)}</>}
            {reminder && !reminder.firedAt && <span title="Reminder"> · 🔔 {fmtTime(reminder.fireAt)}</span>}
          </p>
        )}
      </div>
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
      {editingDue && onSetDue && (
        <DueDropdown
          anchor={dueButton}
          initial={t.dueAt}
          allDay={t.allDay}
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
  const [due, setDue] = useState<DateTimeValue>({ date: null, allDay: false });
  const [remind, setRemind] = useState<"default" | "none" | number>("default");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const dueAt = due.date?.toISOString();
    const allDay = due.allDay;
    create.mutate(
      {
        title,
        ...(dueAt && { dueAt, allDay, tz: localTz() }),
        ...(dueAt && remind !== "default" && { reminderOffset: remind === "none" ? null : remind }),
      },
      { onSuccess: () => { setTitle(""); setDue({ date: null, allDay: false }); setRemind("default"); } },
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
              reminder={reminderByTask.get(t.id)}
              onToggle={(done) => update.mutate({ id: t.id, status: done ? "done" : "todo" })}
              onDelete={() => remove.mutate(t.id)}
              onSetDue={(due) => update.mutate({ id: t.id, dueAt: due?.iso ?? null, allDay: due?.allDay ?? false, tz: localTz() })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
