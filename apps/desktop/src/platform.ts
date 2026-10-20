import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUiState, type Platform } from "@doer/core";

/** Keychain-backed storage (Rust `keyring` behind Tauri commands). */
export const secureStore: Platform["secureStore"] = {
  get: (key) => invoke("secure_get", { key }),
  set: (key, value) => invoke("secure_set", { key, value }),
  remove: (key) => invoke("secure_remove", { key }),
};

const self = getCurrentWindow().label;
type Envelope = { from: string; payload: unknown };

export const platform: Platform = {
  isDesktop: true,
  async notify({ title, body }) {
    if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
    sendNotification({ title, body });
  },
  secureStore,
  openExternal: (url) => openUrl(url),
  saveFile: (name, content) => invoke<string>("save_export", { name, content }),
  async device() {
    const { id, label } = await invoke<{ id: string; label: string }>("device_info");
    return { id, kind: "desktop", label };
  },
  openMainWindow: () => invoke("show_main_window"),
  broadcast: async (event, payload) => {
    // A local write can add/move a reminder: make the Rust scheduler refetch instead of waiting up to 30s.
    if (event === "data:changed" || event === "auth:changed") void invoke("sync_reminders");
    await emit(event, { from: self, payload } satisfies Envelope);
  },
  // Tauri events reach every window, including the sender; drop our own so we don't refetch twice.
  subscribe: (event, handler) =>
    listen<Envelope>(event, ({ payload }) => {
      if (payload.from !== self) handler(payload.payload);
    }),
};

const TOKEN_KEY = "session-token";
// Keychain reads happen on every request otherwise; cache the token in memory.
let token: string | null | undefined;

export const resetTokenCache = () => (token = undefined);
export const getToken = async () => (token === undefined ? (token = await secureStore.get(TOKEN_KEY)) : token);
export const setToken = async (value: string | null) => {
  token = value;
  if (value) await secureStore.set(TOKEN_KEY, value);
  else await secureStore.remove(TOKEN_KEY);
};

/** Keeps the active profile identical in the main window and the bubble. */
export function syncActiveProfile() {
  void platform.subscribe!("profile:changed", (id) => useUiState.getState().setActiveProfile(id as string));
  useUiState.subscribe((s, prev) => {
    if (s.activeProfileId && s.activeProfileId !== prev.activeProfileId) {
      void platform.broadcast!("profile:changed", s.activeProfileId);
    }
  });
}
