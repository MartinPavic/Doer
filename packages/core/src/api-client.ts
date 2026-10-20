import type {
  CreateProfileInput, CreateTaskInput, DeviceInput, ListTasksQuery, PushSubscriptionInput, UpdateProfileInput, UpdateTaskInput,
} from "./schemas";
import type { CalendarAccount, CalendarInfo, Device, ExternalEvent, Profile, Reminder, Task, UpcomingReminder } from "./types";

export interface ApiClientOptions {
  baseUrl: string;
  /** Desktop passes the Keychain bearer token; web relies on the session cookie. */
  getToken?: () => Promise<string | null>;
  /** Persists (or clears, with null) the token the server hands out on sign-in/out. */
  setToken?: (token: string | null) => Promise<void>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken?.();
    const res = await fetch(baseUrl + path, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, body?.error ?? res.statusText);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

  return {
    profiles: {
      list: () => req<Profile[]>("/profiles"),
      create: (input: CreateProfileInput) => req<Profile>("/profiles", json("POST", input)),
      update: (id: string, input: UpdateProfileInput) => req<Profile>(`/profiles/${id}`, json("PATCH", input)),
      remove: (id: string) => req<void>(`/profiles/${id}`, { method: "DELETE" }),
    },
    tasks: {
      list: (profileId: string, q: Partial<ListTasksQuery>) => {
        const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
        return req<Task[]>(`/profiles/${profileId}/tasks?${qs}`);
      },
      create: (profileId: string, input: CreateTaskInput) =>
        req<Task>(`/profiles/${profileId}/tasks`, json("POST", input)),
      update: (profileId: string, id: string, input: UpdateTaskInput) =>
        req<Task>(`/profiles/${profileId}/tasks/${id}`, json("PATCH", input)),
      remove: (profileId: string, id: string) =>
        req<void>(`/profiles/${profileId}/tasks/${id}`, { method: "DELETE" }),
    },
    calendarAccounts: {
      list: (profileId: string) => req<CalendarAccount[]>(`/profiles/${profileId}/calendar-accounts`),
      /** Returns the Google consent URL to open in a browser; the server finishes the link on its callback. */
      startGoogle: (profileId: string, platform: "web" | "desktop") =>
        req<{ url: string }>(`/profiles/${profileId}/calendar-accounts/google/start`, json("POST", { platform })),
      sync: (profileId: string) => req<{ synced: number; errors: number }>(`/profiles/${profileId}/calendar-accounts/sync`, { method: "POST" }),
      remove: (profileId: string, id: string) => req<void>(`/profiles/${profileId}/calendar-accounts/${id}`, { method: "DELETE" }),
      updateCalendar: (profileId: string, id: string, patch: { selected?: boolean; isWriteTarget?: boolean }) =>
        req<CalendarInfo>(`/profiles/${profileId}/calendars/${id}`, json("PATCH", patch)),
    },
    calendar: {
      events: (profileId: string, from: string, to: string) =>
        req<ExternalEvent[]>(`/profiles/${profileId}/calendar/events?${new URLSearchParams({ from, to })}`),
      /** Scheduled tasks overlapping [from, to), plus every recurring task (the client expands those). */
      list: (profileId: string, from: string, to: string) =>
        req<Task[]>(`/profiles/${profileId}/calendar?${new URLSearchParams({ from, to })}`),
    },
    reminders: {
      list: (profileId: string) => req<Reminder[]>(`/profiles/${profileId}/reminders`),
      snooze: (profileId: string, id: string, minutes: number) =>
        req<Reminder>(`/profiles/${profileId}/reminders/${id}/snooze`, json("POST", { minutes })),
      dismiss: (profileId: string, id: string) =>
        req<Reminder>(`/profiles/${profileId}/reminders/${id}/dismiss`, { method: "POST" }),
      upcoming: (deviceId?: string) =>
        req<UpcomingReminder[]>(`/reminders/upcoming${deviceId ? `?deviceId=${deviceId}` : ""}`),
    },
    /** Everything the user owns as JSON (no secrets), for backup. */
    exportData: () => req<unknown>("/export"),
    devices: {
      list: () => req<Device[]>("/devices"),
      upsert: (id: string, input: DeviceInput) => req<Device>(`/devices/${id}`, json("PUT", input)),
    },
    push: {
      publicKey: () => req<{ key: string | null }>("/push/public-key"),
      subscribe: (deviceId: string, input: PushSubscriptionInput) =>
        req<void>(`/devices/${deviceId}/push-subscription`, json("PUT", input)),
      unsubscribe: (deviceId: string) => req<void>(`/devices/${deviceId}/push-subscription`, { method: "DELETE" }),
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;

/** True for failures worth retrying later: no network, or the server is down. */
export const isRetryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;
