import { useDoer } from "@doer/core";
import { AuthForm } from "./AuthForm";
import { ProfileSwitcher, useActiveProfile } from "./ProfileSwitcher";
import { TaskList } from "./TaskList";

function Home() {
  const { auth } = useDoer();
  const profile = useActiveProfile();
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <header className="flex items-center gap-3">
        <div className="flex-1"><ProfileSwitcher /></div>
        <button onClick={() => auth.signOut()} className="text-sm text-neutral-500 underline">Sign out</button>
      </header>
      {profile ? <TaskList key={profile.id} profile={profile} /> : <p className="text-sm text-neutral-500">Loading…</p>}
    </div>
  );
}

export function AppShell() {
  const { auth } = useDoer();
  const { data: session, isPending } = auth.useSession();
  if (isPending) return <p className="p-4 text-sm text-neutral-500">Loading…</p>;
  return session ? <Home /> : <AuthForm />;
}
