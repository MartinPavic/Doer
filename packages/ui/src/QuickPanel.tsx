import { useState, type FormEvent } from "react";
import { useDoer, useTaskMutations, useTasks } from "@doer/core";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useActiveProfile } from "./useActiveProfile";
import { ReminderAlerts } from "./ReminderAlerts";
import { TaskRow } from "./TaskList";

/** Compact "add + today" panel shown by the desktop bubble. */
export function QuickPanel({ onClose }: { onClose?: () => void }) {
  const { auth, platform } = useDoer();
  const { data: session, isPending } = auth.useSession();
  const profile = useActiveProfile();

  const header = (
    <header className="flex items-center gap-2">
      <div className="flex-1">{session && <ProfileSwitcher />}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">
          ✕
        </button>
      )}
    </header>
  );

  let body;
  if (isPending) body = <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  else if (!session)
    body = (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-muted">Sign in to Doer to use the quick panel.</p>
        <button onClick={() => platform.openMainWindow?.()} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
          Open Doer
        </button>
      </div>
    );
  else if (!profile) body = <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  else body = <TodayList key={profile.id} profileId={profile.id} profileName={profile.name} />;

  return (
    <div className="flex h-full flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-2xl">
      {header}
      {session && <ReminderAlerts />}
      <div className="flex min-h-0 flex-1 flex-col gap-3">{body}</div>
      {session && platform.openMainWindow && (
        <button onClick={() => platform.openMainWindow?.()} className="text-sm text-muted transition hover:text-fg">
          Open Doer ↗
        </button>
      )}
    </div>
  );
}

function TodayList({ profileId, profileName }: { profileId: string; profileName: string }) {
  const { data: tasks = [], isPending } = useTasks(profileId, "today");
  const { create, update, remove } = useTaskMutations(profileId);
  const [title, setTitle] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title }, { onSuccess: () => setTitle("") });
  }

  return (
    <>
      <form onSubmit={add}>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Add a ${profileName.toLowerCase()} task…`}
          className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">All clear for today ✨</p>
        ) : (
          <ul className="divide-y divide-line">
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
    </>
  );
}
