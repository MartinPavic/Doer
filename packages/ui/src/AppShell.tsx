import { useState } from "react";
import { useDoer, useThisDevice } from "@doer/core";
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
  useThisDevice(); // registers this install with the server (and keeps lastSeen fresh)
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-8">
      <header className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent font-bold text-accent-fg">✓</div>
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
      <ReminderAlerts />
      {profile ? <TaskList key={profile.id} profile={profile} /> : <p className="py-8 text-center text-sm text-muted">Loading…</p>}
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
