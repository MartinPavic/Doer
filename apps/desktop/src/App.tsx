import { useEffect } from "react";
import { AppShell } from "@doer/ui";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DesktopProvider } from "./DesktopProvider";
import { syncActiveProfile } from "./platform";

// Launch at login by default (reminders need the app running); the user can turn it off later.
async function initAutostart() {
  if (localStorage.getItem("doer-autostart-init")) return;
  localStorage.setItem("doer-autostart-init", "1");
  if (!(await isEnabled())) await enable();
}

export default function App() {
  useEffect(() => {
    void initAutostart().catch(console.warn);
    syncActiveProfile();
  }, []);
  return (
    <DesktopProvider>
      <AppShell />
    </DesktopProvider>
  );
}
