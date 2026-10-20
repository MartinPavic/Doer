import { useDoer } from "@doer/core";
import { AuthForm } from "./AuthForm";
import { ProfileSwitcher, useActiveProfile } from "./ProfileSwitcher";
import { TaskList } from "./TaskList";

function Home() {
  const { auth } = useDoer();
  const profile = useActiveProfile();
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-8">
      <header className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent font-bold text-accent-fg">✓</div>
        <div className="flex-1"><ProfileSwitcher /></div>
        <button onClick={() => auth.signOut()} className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-fg">
          Sign out
        </button>
      </header>
      {profile ? <TaskList key={profile.id} profile={profile} /> : <p className="py-8 text-center text-sm text-muted">Loading…</p>}
    </div>
  );
}

export function AppShell() {
  const { auth } = useDoer();
  const { data: session, isPending } = auth.useSession();
  if (isPending) return <p className="p-8 text-center text-sm text-muted">Loading…</p>;
  return session ? <Home /> : <AuthForm />;
}
