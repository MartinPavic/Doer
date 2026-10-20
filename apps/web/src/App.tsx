import { DoerProvider, type Platform } from "@doer/core";
import { AppShell } from "@doer/ui";

// Browser can't hold secrets or notify yet (Phase 4 adds Web Push); cookies carry the session.
const platform: Platform = {
  isDesktop: false,
  notify: async ({ title, body }) => {
    if (Notification.permission === "granted") new Notification(title, { body });
  },
  secureStore: {
    get: async (k) => localStorage.getItem(k),
    set: async (k, v) => localStorage.setItem(k, v),
    remove: async (k) => localStorage.removeItem(k),
  },
  openExternal: async (url) => void window.open(url, "_blank", "noopener"),
};

export default function App() {
  return (
    <DoerProvider platform={platform} baseUrl="">
      <AppShell />
    </DoerProvider>
  );
}
