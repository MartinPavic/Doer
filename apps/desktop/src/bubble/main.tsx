import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DesktopProvider } from "../DesktopProvider";
import { platform, resetTokenCache, syncActiveProfile } from "../platform";
import { Bubble } from "./Bubble";
import "./bubble.css";

function Root() {
  useEffect(() => {
    syncActiveProfile();
    // Main window signed in/out: our cached token is stale, so start fresh.
    const off = platform.subscribe!("auth:changed", () => {
      resetTokenCache();
      location.reload();
    });
    return () => void off.then((f) => f());
  }, []);
  return (
    <DesktopProvider>
      <Bubble />
    </DesktopProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
