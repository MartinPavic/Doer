import { useState } from "react";
import { useDoer, useThisDevice, useUiState } from "@doer/core";
import { CalendarView } from "./CalendarView";
import { Logo } from "./Logo";
import { ReminderAlerts } from "./ReminderAlerts";
import { SettingsDialog } from "./SettingsDialog";
import { AuthForm } from "./AuthForm";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useActiveProfile } from "./useActiveProfile";
import { TaskList } from "./TaskList";

function Home() {
  const { auth } = useDoer();
  const profile = useActiveProfile();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const page = useUiState((s) => s.page);
  const setPage = useUiState((s) => s.setPage);
  useThisDevice(); // registers this install with the server (and keeps lastSeen fresh)
  return (
    <div className={`mx-auto space-y-5 px-4 py-8 ${page === "calendar" ? "max-w-5xl" : "max-w-xl"}`}>
      <header className="flex items-center gap-3">
        <Logo size={36} className="shrink-0" />
        <div className="flex-1"><ProfileSwitcher /></div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          disabled={!profile}
          className="rounded-lg px-2.5 py-1.5 text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        >
          ⚙
        </button>
        <button onClick={() => auth.signOut()} className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-fg">
          Sign out
        </button>
      </header>
      <nav className="flex gap-1">
        {([["tasks", "Tasks"], ["calendar", "Calendar"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${page === id ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <ReminderAlerts />
      {!profile ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : page === "calendar" ? (
        <CalendarView key={`calendar-${profile.id}`} profile={profile} />
      ) : (
        <TaskList key={profile.id} profile={profile} />
      )}
      {settingsOpen && profile && (
        <SettingsDialog key={`settings-${profile.id}`} profile={profile} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

export function AppShell() {
  const { auth } = useDoer();
  const { data: session, isPending } = auth.useSession();
  if (isPending) return <p className="p-8 text-center text-sm text-muted">Loading…</p>;
  return session ? <Home /> : <AuthForm />;
}
