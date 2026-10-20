import { useProfiles, useUiState, type Profile } from "@doer/core";

/** Returns the active profile, falling back to the first one if the stored id is stale. */
export function useActiveProfile(): Profile | undefined {
  const { data } = useProfiles();
  const id = useUiState((s) => s.activeProfileId);
  return data?.find((p) => p.id === id) ?? data?.[0];
}

export function ProfileSwitcher() {
  const { data: profiles = [] } = useProfiles();
  const active = useActiveProfile();
  const setActive = useUiState((s) => s.setActiveProfile);
  return (
    <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
      {profiles.map((p) => (
        <button
          key={p.id}
          onClick={() => setActive(p.id)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm ${
            p.id === active?.id ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"
          }`}
        >
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}
        </button>
      ))}
    </div>
  );
}
