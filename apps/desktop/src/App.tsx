import { DoerProvider, type Platform } from "@doer/core";
import { AppShell } from "@doer/ui";

// Placeholder until Phase 2: real notify/Keychain/opener come from Tauri plugins + bearer-token login.
const platform: Platform = {
  isDesktop: true,
  notify: async () => {},
  secureStore: {
    get: async (k) => localStorage.getItem(k),
    set: async (k, v) => localStorage.setItem(k, v),
    remove: async (k) => localStorage.removeItem(k),
  },
  openExternal: async (url) => void window.open(url, "_blank", "noopener"),
};

export default function App() {
  return (
    <DoerProvider platform={platform} baseUrl={import.meta.env.VITE_API_URL ?? "http://localhost:8787"}>
      <AppShell />
    </DoerProvider>
  );
}
