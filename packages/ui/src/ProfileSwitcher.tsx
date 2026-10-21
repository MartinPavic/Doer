import { useEffect } from "react";
import { useProfiles, useUiState } from "@doer/core";
import { useActiveProfile } from "./useActiveProfile";

export function ProfileSwitcher() {
  const { data: profiles = [] } = useProfiles();
  const active = useActiveProfile();
  const setActive = useUiState((s) => s.setActiveProfile);

  // Option+Tab cycles to the next profile (Shift reverses).
  useEffect(() => {
    if (profiles.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.key !== "Tab") return;
      e.preventDefault();
      const i = profiles.findIndex((p) => p.id === active?.id);
      const step = e.shiftKey ? -1 : 1;
      setActive(profiles[(i + step + profiles.length) % profiles.length]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profiles, active?.id, setActive]);

  return (
    <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {profiles.map((p) => {
        const on = p.id === active?.id;
        return (
          <button
            key={p.id}
            onClick={() => setActive(p.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              on ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
