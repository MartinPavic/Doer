import { useState, type ReactNode } from "react";
import { describeRrule, type ExternalEvent, type Profile, type Task } from "@doer/core";
import { DateTimeField, formatDue, type DateTimeValue } from "./DateTimePicker";

function Modal({ title, onClose, children }: { title: ReactNode; onClose(): void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        className="w-full max-w-sm space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-0.5 text-muted hover:bg-surface-2">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export interface NewTaskDraft {
  title: string;
  due: DateTimeValue;
  /** Set when the user dragged a time range, so the task spans it. */
  end: Date | null;
}

export function NewTaskDialog({
  profile,
  initial,
  onCreate,
  onClose,
}: {
  profile: Profile;
  initial: { due: DateTimeValue; end: Date | null };
  onCreate(draft: NewTaskDraft): void;
  onClose(): void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(initial.due);
  return (
    <Modal
      title={<span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: profile.color }} />New {profile.name.toLowerCase()} task</span>}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate({ title: title.trim(), due, end: initial.end });
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        <DateTimeField value={due} onChange={setDue} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-surface-2">Cancel</button>
          <button
            disabled={!title.trim()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            Add task
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Always-visible notes box for the task dialog; Save appears once there's something to save. */
function NotesField({ notes, onSave }: { notes: string | null; onSave(notes: string | null): void }) {
  const [draft, setDraft] = useState(notes ?? "");
  const dirty = draft.trim() !== (notes ?? "").trim();
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-muted" htmlFor="task-notes">Notes</label>
      <textarea
        id="task-notes"
        value={draft}
        maxLength={20_000}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && dirty) {
            e.preventDefault();
            onSave(draft.trim() || null);
          }
        }}
        placeholder="Add notes: details, links, what “done” looks like…"
        className="w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
      />
      {dirty && (
        <div className="flex justify-end gap-1">
          <button onClick={() => setDraft(notes ?? "")} className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface-2">Revert</button>
          <button onClick={() => onSave(draft.trim() || null)} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg">Save notes</button>
        </div>
      )}
    </div>
  );
}

export function TaskDetailDialog({
  task,
  occurrence,
  pastDone,
  profile,
  readOnly,
  canMirror,
  onToggleDone,
  onSetMirror,
  onSetNotes,
  onDelete,
  onClose,
}: {
  task: Task;
  /** The clicked occurrence of a recurring task (null for one-off tasks). */
  occurrence: Date | null;
  /** The clicked occurrence is a completed one from history. */
  pastDone: boolean;
  profile: Profile;
  /** Overlay tasks from the other profile can be looked at, not changed. */
  readOnly: boolean;
  /** This profile mirrors tasks to a calendar, so a per-task override makes sense. */
  canMirror: boolean;
  onToggleDone(done: boolean): void;
  onSetMirror(mirror: boolean | null): void;
  onSetNotes(notes: string | null): void;
  onDelete(): void;
  onClose(): void;
}) {
  const recurring = !!task.rrule;
  // A recurring task always points at its next occurrence, so only that one can be completed.
  const isCurrent = !!occurrence && !!task.dueAt && Math.abs(occurrence.getTime() - new Date(task.dueAt).getTime()) < 60_000;
  const done = recurring ? pastDone : task.status === "done";
  const canToggle = !readOnly && (!recurring || (isCurrent && !pastDone));
  const shown = recurring ? occurrence : task.dueAt ? new Date(task.dueAt) : null;
  const when = shown ? formatDue({ date: shown, allDay: task.allDay }) : "Unscheduled";
  return (
    <Modal
      title={<span className={done ? "text-muted line-through" : ""}>{task.title}</span>}
      onClose={onClose}
    >
      <div className="space-y-1 text-sm text-muted">
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: profile.color }} />
          {profile.name}
        </p>
        <p>📅 {when}</p>
        {recurring && <p>🔁 {describeRrule(task.rrule)}</p>}
        {readOnly && task.notes && <p className="whitespace-pre-wrap text-fg">{task.notes}</p>}
      </div>
      {!readOnly && <NotesField key={task.id} notes={task.notes} onSave={onSetNotes} />}
      {readOnly ? (
        <p className="text-xs text-muted">Switch to the {profile.name} profile to edit this task.</p>
      ) : (
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={done}
              disabled={!canToggle}
              onChange={(e) => onToggleDone(e.target.checked)}
              className="size-[18px]"
            />
            Done
          </label>
          <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-sm text-danger hover:bg-danger/10">Delete</button>
        </div>
      )}
      {!readOnly && canMirror && (
        <label className="flex items-center justify-between gap-3 text-sm text-muted">
          In Google Calendar
          <select
            value={task.mirror === null ? "" : String(task.mirror)}
            onChange={(e) => onSetMirror(e.target.value === "" ? null : e.target.value === "true")}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-fg outline-none focus:border-accent"
          >
            <option value="">Follow profile default</option>
            <option value="true">Always</option>
            <option value="false">Never</option>
          </select>
        </label>
      )}
      {!readOnly && recurring && !canToggle && !pastDone && (
        <p className="text-xs text-muted">Complete the next occurrence first; later ones unlock as you go.</p>
      )}
    </Modal>
  );
}

/** Read-only look at an event from a connected calendar. */
export function ExternalEventDialog({
  event,
  calendarName,
  onOpenLink,
  onClose,
}: {
  event: ExternalEvent;
  calendarName?: string;
  onOpenLink(url: string): void;
  onClose(): void;
}) {
  const start = new Date(event.startAt);
  // All-day dates are UTC midnights; their calendar date is the UTC date, not the local one.
  const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const when = event.allDay
    ? dayLabel(start)
    : `${formatDue({ date: start, allDay: false })}${event.endAt ? ` – ${new Date(event.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}`;
  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-1 text-sm text-muted">
        <p className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: event.color ?? "#64748b" }} />
          {calendarName ?? "Google Calendar"}
        </p>
        <p>📅 {when}</p>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Edit this event in Google Calendar.</p>
        {event.link && (
          <button onClick={() => onOpenLink(event.link!)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">
            Open in Google ↗
          </button>
        )}
      </div>
    </Modal>
  );
}
