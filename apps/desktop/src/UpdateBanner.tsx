import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

const RECHECK_MS = 6 * 3600_000;

/**
 * Looks for a new release at startup and every few hours. Release builds only: in dev the updater isn't
 * registered, `check()` throws, and we stay silent. Installing needs a click, so it never restarts the app
 * (and its reminder scheduler) behind your back.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<"idle" | "installing" | "error">("idle");

  useEffect(() => {
    let alive = true;
    const run = () => check().then((u) => alive && u && setUpdate(u)).catch(() => {});
    void run();
    const t = setInterval(run, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!update) return null;

  async function install() {
    setState("installing");
    try {
      await update!.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error("update failed", e);
      setState("error");
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm shadow-2xl">
      <span>
        {state === "error" ? "Update failed. Try again later." : <>Doer <b>{update.version}</b> is available.</>}
      </span>
      {state !== "error" && (
        <button
          onClick={() => void install()}
          disabled={state === "installing"}
          className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-accent-fg disabled:opacity-60"
        >
          {state === "installing" ? "Installing…" : "Update & restart"}
        </button>
      )}
      <button onClick={() => setUpdate(null)} aria-label="Dismiss" className="text-muted hover:text-fg">✕</button>
    </div>
  );
}
