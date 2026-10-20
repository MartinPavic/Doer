import type { ReactNode } from "react";
import { DoerProvider } from "@doer/core";
import { clearOfflineData, withOfflineSupport } from "./offline";
import { getToken, platform, setToken as storeToken } from "./platform";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

// Signing out also wipes the local cache so the next account never sees this one's tasks;
// every token change is announced so the other window (bubble) can reload its session.
const setToken = async (value: string | null) => {
  await storeToken(value);
  if (value === null) await clearOfflineData();
  await platform.broadcast!("auth:changed");
};

export function DesktopProvider({ children }: { children: ReactNode }) {
  return (
    <DoerProvider
      platform={platform}
      baseUrl={API_URL}
      getToken={getToken}
      setToken={setToken}
      wrapApi={withOfflineSupport}
    >
      {children}
    </DoerProvider>
  );
}
