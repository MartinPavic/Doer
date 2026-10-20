import { useState, type FormEvent } from "react";
import { useTaskMutations, useTasks, useUiState, type Profile, type Task, type TaskView } from "@doer/core";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
];

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function TaskRow({
  task: t,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle(done: boolean): void;
  onDelete(): void;
}) {
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
        {t.dueAt && (
          <p className={`mt-0.5 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
            {overdue ? "Overdue · " : ""}{fmt(t.dueAt)}
          </p>
        )}
      </div>
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
  const [title, setTitle] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title }, { onSuccess: () => setTitle("") });
  }

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
              onToggle={(done) => update.mutate({ id: t.id, status: done ? "done" : "todo" })}
              onDelete={() => remove.mutate(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
