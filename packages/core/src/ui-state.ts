import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TaskView } from "./schemas";

interface UiState {
  activeProfileId: string | null;
  view: TaskView;
  page: "tasks" | "calendar";
  calendarView: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listWeek";
  /** Overlay the other profile(s) on the calendar, read-only and dimmed. */
  overlayOthers: boolean;
  setActiveProfile(id: string): void;
  setView(v: TaskView): void;
  setPage(p: "tasks" | "calendar"): void;
  setCalendarView(v: UiState["calendarView"]): void;
  setOverlayOthers(on: boolean): void;
}

export const useUiState = create<UiState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      view: "today",
      page: "tasks",
      calendarView: "dayGridMonth",
      overlayOthers: false,
      setActiveProfile: (activeProfileId) => set({ activeProfileId }),
      setView: (view) => set({ view }),
      setPage: (page) => set({ page }),
      setCalendarView: (calendarView) => set({ calendarView }),
      setOverlayOthers: (overlayOthers) => set({ overlayOthers }),
    }),
    { name: "doer-ui" },
  ),
);
