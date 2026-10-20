import { DoerProvider, type Platform } from "@doer/core";
import { AppShell } from "@doer/ui";

// Browser can't hold secrets or notify yet (Phase 4 adds Web Push); cookies carry the session.
const b64urlToBytes = (s: string) => {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

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
  async enablePush(vapidPublicKey) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser doesn't support push notifications.");
    if ((await Notification.requestPermission()) !== "granted") return null;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToBytes(vapidPublicKey),
    });
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
  },
  async disablePush() {
    const reg = await navigator.serviceWorker?.getRegistration("/sw.js");
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  },
  async saveFile(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
    return "your browser's downloads";
  },
  async device() {
    let id = localStorage.getItem("doer-device-id");
    if (!id) localStorage.setItem("doer-device-id", (id = crypto.randomUUID()));
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : "Safari";
    return { id, kind: "web", label: `${browser} (web)` };
  },
};

export default function App() {
  return (
    <DoerProvider platform={platform} baseUrl={import.meta.env.VITE_API_URL ?? ""}>
      <AppShell />
    </DoerProvider>
  );
}
