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
  /** Desktop only: bring the main window to the front (used by the bubble). */
  openMainWindow?(): Promise<void>;
  /** Desktop only: cross-window messaging, so the bubble and main window stay in sync. */
  broadcast?(event: string, payload?: unknown): Promise<void>;
  /** Handler fires for messages from *other* windows; resolves to an unsubscribe function. */
  subscribe?(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}
