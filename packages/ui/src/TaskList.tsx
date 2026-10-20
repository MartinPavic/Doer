import { useState, type FormEvent } from "react";
import { useTaskMutations, useTasks, useUiState, type Profile, type TaskView } from "@doer/core";

const VIEWS: { id: TaskView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
];

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

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

  const now = Date.now();
  return (
    <div className="space-y-4">
      <nav className="flex gap-4 border-b border-neutral-200 text-sm dark:border-neutral-800">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`-mb-px border-b-2 pb-2 ${view === v.id ? "border-current font-medium" : "border-transparent text-neutral-500"}`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <form onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Add a ${profile.name.toLowerCase()} task…`}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </form>

      {isPending && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {!isPending && tasks.length === 0 && <p className="text-sm text-neutral-500">Nothing here.</p>}

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {tasks.map((t) => {
          const overdue = t.status === "todo" && t.dueAt && new Date(t.dueAt).getTime() < now;
          return (
            <li key={t.id} className="group flex items-center gap-3 py-2">
              <input
                type="checkbox"
                checked={t.status === "done"}
                onChange={(e) => update.mutate({ id: t.id, status: e.target.checked ? "done" : "todo" })}
                className="size-4"
              />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${t.status === "done" ? "text-neutral-400 line-through" : ""}`}>{t.title}</p>
                {t.dueAt && (
                  <p className={`text-xs ${overdue ? "text-red-600" : "text-neutral-500"}`}>{fmt(t.dueAt)}</p>
                )}
              </div>
              <button
                onClick={() => remove.mutate(t.id)}
                aria-label="Delete task"
                className="text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
