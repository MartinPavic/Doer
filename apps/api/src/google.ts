// Thin Google OAuth + Calendar v3 client. `fetchImpl` is injectable so tests (and the sync engine's
// tests) never touch the network.

export type GoogleEnv = { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
type Fetch = typeof fetch;

const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

/** The refresh token is dead (revoked / expired): the account needs to be reconnected. */
export class GoogleAuthError extends Error {}
/** 410: the sync token expired, do a full resync. */
export class GoogleGoneError extends Error {}
/** 404: the calendar or event no longer exists. */
export class GoogleNotFoundError extends Error {}

const need = (env: GoogleEnv) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error("Google is not configured");
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
};

export function authUrl(env: GoogleEnv, redirectUri: string, state: string, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: need(env).id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // we need a refresh token…
    prompt: "consent", // …and Google only sends one on a fresh consent
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) q.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

const tokenRequest = async (env: GoogleEnv, body: Record<string, string>, f: Fetch) => {
  const { id, secret } = need(env);
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GoogleAuthError(json.error_description ?? "invalid_grant");
    throw new Error(`Google token endpoint: ${res.status} ${json.error ?? ""}`);
  }
  return json;
};

/** Exchanges the OAuth code. The email comes from the id_token we just received over TLS from Google. */
export async function exchangeCode(env: GoogleEnv, redirectUri: string, code: string, f: Fetch = fetch) {
  const t = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, f);
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token (was consent skipped?)");
  const claims = JSON.parse(atob(t.id_token!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string };
  if (!claims.email) throw new Error("Google didn't return an email address");
  return { refreshToken: t.refresh_token, accessToken: t.access_token!, email: claims.email, scopes: t.scope ?? GOOGLE_SCOPES.join(" ") };
}

export async function refreshAccessToken(env: GoogleEnv, refreshToken: string, f: Fetch = fetch): Promise<string> {
  return (await tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken }, f)).access_token!;
}

export async function revokeToken(token: string, f: Fetch = fetch) {
  await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

// --- Calendar API ---------------------------------------------------------------------------

export interface GoogleCalendarListEntry { id: string; summary: string; primary?: boolean; backgroundColor?: string; accessRole: string }
export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
  [k: string]: unknown;
}
/** What we send when creating/patching an event. A `null` clears a field (needed to switch timed <-> all-day on patch). */
export interface GoogleEventBody {
  summary?: string;
  description?: string;
  start?: { date?: string | null; dateTime?: string | null; timeZone?: string };
  end?: { date?: string | null; dateTime?: string | null; timeZone?: string };
  reminders?: { useDefault: boolean };
  extendedProperties?: { private: Record<string, string> };
}
export interface EventsPage { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }

export function googleCalendar(accessToken: string, f: Fetch = fetch) {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await f(API + path, { ...init, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init.headers } });
    if (res.status === 410) throw new GoogleGoneError("sync token expired");
    if (res.status === 401) throw new GoogleAuthError("access token rejected");
    if (res.status === 404) throw new GoogleNotFoundError("not found");
    if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  };

  return {
    async listCalendars(): Promise<GoogleCalendarListEntry[]> {
      const out: GoogleCalendarListEntry[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({ maxResults: "250", ...(pageToken && { pageToken }) });
        const page = await call<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(`/users/me/calendarList?${q}`);
        out.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return out;
    },

    /**
     * One page of events. With a `syncToken` Google returns only changes since then (including
     * cancellations); without one it's a full listing inside [timeMin, timeMax]. Recurring events
     * come expanded into instances (`singleEvents`), so each occurrence is its own row.
     */
    listEvents(calendarId: string, o: { syncToken?: string; timeMin?: string; timeMax?: string; pageToken?: string }): Promise<EventsPage> {
      const q = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
      if (o.syncToken) q.set("syncToken", o.syncToken);
      else {
        if (o.timeMin) q.set("timeMin", o.timeMin);
        if (o.timeMax) q.set("timeMax", o.timeMax);
      }
      if (o.pageToken) q.set("pageToken", o.pageToken);
      return call<EventsPage>(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    },

    insertEvent: (calendarId: string, body: GoogleEventBody) =>
      call<GoogleEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(body) }),

    patchEvent: (calendarId: string, eventId: string, body: GoogleEventBody) =>
      call<GoogleEvent>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),

    /** Idempotent: an event that's already gone counts as deleted. */
    async deleteEvent(calendarId: string, eventId: string) {
      try {
        await call<void>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
      } catch (e) {
        if (!(e instanceof GoogleNotFoundError) && !(e instanceof GoogleGoneError)) throw e;
      }
    },
  };
}
export type GoogleCalendar = ReturnType<typeof googleCalendar>;
