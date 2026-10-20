import { useProfiles, useUiState, type Profile } from "@doer/core";

/** Returns the active profile, falling back to the first one if the stored id is stale. */
export function useActiveProfile(): Profile | undefined {
  const { data } = useProfiles();
  const id = useUiState((s) => s.activeProfileId);
  return data?.find((p) => p.id === id) ?? data?.[0];
}
