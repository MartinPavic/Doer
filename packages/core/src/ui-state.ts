import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TaskView } from "./schemas";

interface UiState {
  activeProfileId: string | null;
  view: TaskView;
  setActiveProfile(id: string): void;
  setView(v: TaskView): void;
}

export const useUiState = create<UiState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      view: "today",
      setActiveProfile: (activeProfileId) => set({ activeProfileId }),
      setView: (view) => set({ view }),
    }),
    { name: "doer-ui" },
  ),
);
