import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Platform } from "@doer/core";

/** Keychain-backed storage (Rust `keyring` behind Tauri commands). */
export const secureStore: Platform["secureStore"] = {
  get: (key) => invoke("secure_get", { key }),
  set: (key, value) => invoke("secure_set", { key, value }),
  remove: (key) => invoke("secure_remove", { key }),
};

export const platform: Platform = {
  isDesktop: true,
  async notify({ title, body }) {
    if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
    sendNotification({ title, body });
  },
  secureStore,
  openExternal: (url) => openUrl(url),
};

const TOKEN_KEY = "session-token";
// Keychain reads happen on every request otherwise; cache the token in memory.
let token: string | null | undefined;

export const getToken = async () => (token === undefined ? (token = await secureStore.get(TOKEN_KEY)) : token);
export const setToken = async (value: string | null) => {
  token = value;
  if (value) await secureStore.set(TOKEN_KEY, value);
  else await secureStore.remove(TOKEN_KEY);
};
