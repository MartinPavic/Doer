import { useAlertActions, useDueReminders } from "@doer/core";

/** Fired-but-unhandled reminders with one-tap Done / Snooze / Dismiss. Renders nothing when there are none. */
export function ReminderAlerts() {
  const { data: due = [] } = useDueReminders();
  const { snooze, done, dismiss } = useAlertActions();
  if (due.length === 0) return null;

  const btn = "rounded-lg px-2.5 py-1 text-xs font-medium transition";
  return (
    <ul className="space-y-2">
      {due.map((r) => (
        <li key={r.id} className="rounded-2xl border border-accent/40 bg-accent/10 p-3">
          <div className="flex items-start gap-2">
            <span aria-hidden>🔔</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted">{r.profileName}</p>
            </div>
            <button
              onClick={() => dismiss.mutate({ profileId: r.profileId, id: r.id })}
              aria-label="Dismiss reminder"
              className="rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => done.mutate({ profileId: r.profileId, taskId: r.taskId })}
              className={`${btn} bg-accent text-accent-fg hover:brightness-110`}
            >
              ✓ Done
            </button>
            {[10, 60].map((m) => (
              <button
                key={m}
                onClick={() => snooze.mutate({ profileId: r.profileId, id: r.id, minutes: m })}
                className={`${btn} bg-surface text-fg hover:bg-surface-2`}
              >
                Snooze {m === 60 ? "1h" : `${m}m`}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
