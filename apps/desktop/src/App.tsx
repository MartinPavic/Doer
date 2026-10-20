import { useEffect } from "react";
import { DoerProvider } from "@doer/core";
import { AppShell } from "@doer/ui";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { clearOfflineData, withOfflineSupport } from "./offline";
import { getToken, platform, setToken as storeToken } from "./platform";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// Signing out also wipes the local cache so the next account never sees this one's tasks.
const setToken = async (value: string | null) => {
  await storeToken(value);
  if (value === null) await clearOfflineData();
};

// Launch at login by default (reminders need the app running); the user can turn it off later.
async function initAutostart() {
  if (localStorage.getItem("doer-autostart-init")) return;
  localStorage.setItem("doer-autostart-init", "1");
  if (!(await isEnabled())) await enable();
}

export default function App() {
  useEffect(() => void initAutostart().catch(console.warn), []);
  return (
    <DoerProvider
      platform={platform}
      baseUrl={API_URL}
      getToken={getToken}
      setToken={setToken}
      wrapApi={withOfflineSupport}
    >
      <AppShell />
    </DoerProvider>
  );
}
