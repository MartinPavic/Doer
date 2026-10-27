import { isRegistered, register, unregister } from "@tauri-apps/plugin-global-shortcut";

const SHORTCUT = "Alt+Space";
let shortcutQueue: Promise<unknown> = Promise.resolve();
const queueShortcut = (fn: () => Promise<unknown>) =>
  (shortcutQueue = shortcutQueue.then(fn).catch((err) => console.warn(`${SHORTCUT} shortcut`, err)));

export const registerShortcut = (handler: Parameters<typeof register>[1]) =>
  queueShortcut(async () => {
    if (await isRegistered(SHORTCUT)) await unregister(SHORTCUT);
    await register(SHORTCUT, handler);
  });

export const unregisterShortcut = () => queueShortcut(() => unregister(SHORTCUT));