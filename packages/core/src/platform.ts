/** The only place web/desktop differences leak into shared code. */
export interface Platform {
  isDesktop: boolean;
  notify(opts: { title: string; body?: string }): Promise<void>;
  secureStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  openExternal(url: string): Promise<void>;
  /** Stable id + name of this install; the server tracks it to decide where reminders alert. */
  device(): Promise<{ id: string; kind: "web" | "desktop"; label: string }>;
  /** Web only: asks permission and creates a Web Push subscription; null if the user declined. */
  enablePush?(vapidPublicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } } | null>;
  /** Web only: removes this browser's push subscription. */
  disablePush?(): Promise<void>;
  /** Desktop only: bring the main window to the front (used by the bubble). */
  openMainWindow?(): Promise<void>;
  /** Desktop only: cross-window messaging, so the bubble and main window stay in sync. */
  broadcast?(event: string, payload?: unknown): Promise<void>;
  /** Handler fires for messages from *other* windows; resolves to an unsubscribe function. */
  subscribe?(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}
