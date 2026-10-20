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
}
