import { describe, expect, it } from "vitest";
import { GoogleAuthError, GoogleGoneError, authUrl, exchangeCode, googleCalendar, refreshAccessToken } from "./google";
import { mapGoogleEvent } from "./calendar-sync";

const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const idToken = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;

describe("authUrl", () => {
  it("asks for offline access with forced consent and the calendar scopes", () => {
    const u = new URL(authUrl(env, "http://localhost:8787/oauth/google/callback", "STATE"));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("scope")).toContain("calendar.events");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:8787/oauth/google/callback");
  });
  it("refuses without credentials", () => expect(() => authUrl({}, "x", "y")).toThrow(/not configured/));
});

describe("token endpoint", () => {
  it("exchanges a code and reads the email from the id_token", async () => {
    let sent = "";
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return json({ access_token: "at", refresh_token: "rt", id_token: idToken({ email: "me@gmail.com" }), scope: "s" });
    }) as unknown as typeof fetch;
    const r = await exchangeCode(env, "http://cb", "CODE", f);
    expect(r).toMatchObject({ refreshToken: "rt", accessToken: "at", email: "me@gmail.com" });
    expect(sent).toContain("grant_type=authorization_code");
    expect(sent).toContain("code=CODE");
  });
  it("fails clearly when no refresh token comes back", async () => {
    const f = (async () => json({ access_token: "at", id_token: idToken({ email: "a@b.c" }) })) as unknown as typeof fetch;
    await expect(exchangeCode(env, "http://cb", "C", f)).rejects.toThrow(/refresh token/);
  });
  it("maps invalid_grant to GoogleAuthError (account needs reconnecting)", async () => {
    const f = (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    await expect(refreshAccessToken(env, "rt", f)).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe("calendar API", () => {
  it("lists calendars across pages", async () => {
    const pages = [{ items: [{ id: "a" }], nextPageToken: "p2" }, { items: [{ id: "b" }] }];
    let i = 0;
    const f = (async () => json(pages[i++])) as unknown as typeof fetch;
    expect((await googleCalendar("t", f).listCalendars()).map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("sends syncToken instead of a time window, and maps 410 / 401", async () => {
    let url = "";
    const ok = (async (u: string) => ((url = u), json({ items: [] }))) as unknown as typeof fetch;
    await googleCalendar("t", ok).listEvents("a@b.c", { syncToken: "ST", timeMin: "2026-01-01T00:00:00Z" });
    expect(url).toContain("syncToken=ST");
    expect(url).not.toContain("timeMin");
    expect(url).toContain("singleEvents=true");
    expect(url).toContain("calendars/a%40b.c/");
    const gone = (async () => new Response("", { status: 410 })) as unknown as typeof fetch;
    await expect(googleCalendar("t", gone).listEvents("c", { syncToken: "x" })).rejects.toBeInstanceOf(GoogleGoneError);
    const unauth = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    await expect(googleCalendar("t", unauth).listEvents("c", {})).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe("mapGoogleEvent", () => {
  it("maps a timed event", () => {
    const r = mapGoogleEvent("cal", { id: "e1", etag: '"1"', summary: " Standup ", start: { dateTime: "2026-10-21T09:00:00+02:00" }, end: { dateTime: "2026-10-21T09:30:00+02:00" } });
    expect(r).toMatchObject({ externalId: "e1", title: "Standup", allDay: false, calendarId: "cal" });
    expect((r as { startAt: Date }).startAt.toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
  it("maps all-day events to UTC midnight and keeps the exclusive end", () => {
    const r = mapGoogleEvent("cal", { id: "e2", start: { date: "2026-10-22" }, end: { date: "2026-10-23" } }) as { startAt: Date; endAt: Date; allDay: boolean; title: string };
    expect(r.allDay).toBe(true);
    expect(r.startAt.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(r.endAt.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(r.title).toBe("(No title)");
  });
  it("flags cancellations and ignores events without a start", () => {
    expect(mapGoogleEvent("cal", { id: "x", status: "cancelled" })).toBe("cancelled");
    expect(mapGoogleEvent("cal", { id: "y" })).toBeNull();
  });
});
