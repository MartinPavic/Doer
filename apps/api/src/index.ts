import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  calendarQuery, createProfileInput, createTaskInput, deviceInput, listTasksQuery, pushSubscriptionInput, snoozeInput, updateProfileInput, updateTaskInput,
} from "@doer/core/schemas";
import { allowedOrigins, createAuth, type AuthEnv } from "./auth";
import { getDb, type Db } from "./db/client";
import { profile } from "./db/schema";
import { reconcileMirrors } from "./calendar-mirror";
import { googleClientFor, rotateTokenKeys, syncDueCalendars, type CalendarEnv } from "./calendar-service";
import { decryptToken, encryptToken } from "./crypto";
import { dispatchDueReminders } from "./dispatch";
import { authUrl, exchangeCode, googleCalendar, revokeToken } from "./google";
import { signState, verifyState } from "./signed-state";
import type { PushEnv } from "./push";
import { forUser } from "./user-scope";
import { withProfile } from "./with-profile";

export type Env = AuthEnv & PushEnv & CalendarEnv & {
  // Cloudflare rate-limit bindings (see wrangler.toml); absent in tests/other runtimes, where limiting is skipped.
  AUTH_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;
  SENTRY_DSN?: string;
};
type Vars = { userId: string; db: Db };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// nosniff / frame-deny / referrer policy etc. on every response (including the OAuth result pages).
app.use("*", secureHeaders());

app.use("*", (c, next) =>
  cors({
    origin: allowedOrigins(c.env),
    credentials: true,
    exposeHeaders: ["set-auth-token"],
  })(c, next),
);

/** 429 once `key` exceeds the binding's budget. Fails open if the limiter itself errors: never lock users out over it. */
const rateLimited = async (limiter: RateLimit | undefined, key: string) => {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
};
const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";

// Credential guessing: throttle every sign-in/up/reset POST per IP. Reads (get-session) are cheap and frequent, so they're exempt.
app.use("/api/auth/*", async (c, next) => {
  if (c.req.method === "POST" && (await rateLimited(c.env.AUTH_LIMITER, clientIp(c.req.raw)))) {
    return c.json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));
app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// --- Google connected-account OAuth (public callback: identity comes from the signed `state`) ---------------
const page = (title: string, body: string, status: 200 | 400 | 501 = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;background:#0b0c10;color:#f1f2f6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">` +
      `<div style="max-width:24rem;padding:2rem;text-align:center"><h1 style="font-size:1.25rem">${title}</h1><p style="color:#8b90a3">${body}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

app.get("/oauth/google/callback", async (c) => {
  const env = c.env;
  const state = await verifyState<{ uid: string; pid: string; ret: "web" | "desktop" }>(c.req.query("state") ?? "", env.BETTER_AUTH_SECRET);
  if (!state) return page("Link expired", "Start the connection again from Doer.", 400);
  if (c.req.query("error")) return page("Not connected", `Google said: ${escapeHtml(c.req.query("error")!)}. You can close this tab.`, 400);
  const code = c.req.query("code");
  if (!code || !env.TOKEN_ENC_KEY) return page("Not connected", "The server isn't fully configured for calendars.", 400);

  try {
    const db = getDb(env.DATABASE_URL);
    const scope = await withProfile(db, state.uid, state.pid); // the profile must still belong to that user
    if (!scope) return page("Not connected", "That profile no longer exists.", 400);
    const tokens = await exchangeCode(env, `${env.BETTER_AUTH_URL}/oauth/google/callback`, code);
    const calendars = await googleCalendar(tokens.accessToken).listCalendars();
    await scope.calendars.saveGoogleAccount({
      email: tokens.email,
      refreshTokenEnc: await encryptToken(tokens.refreshToken, env.TOKEN_ENC_KEY),
      scopes: tokens.scopes,
      calendars,
    });
    c.executionCtx.waitUntil(scope.calendars.syncNow(env)); // first import runs in the background
    if (state.ret === "web") return c.redirect(`${env.WEB_ORIGIN}/?calendar=connected`);
    return page("Google Calendar connected ✓", `${escapeHtml(tokens.email)} is linked. You can close this tab and return to Doer.`);
  } catch (e) {
    console.error("[google callback]", e);
    return page("Not connected", "Something went wrong while linking your account. Please try again.", 400);
  }
});

const api = new Hono<{ Bindings: Env; Variables: Vars }>();
api.use("*", async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (await rateLimited(c.env.API_LIMITER, session.user.id)) return c.json({ error: "Too many requests" }, 429);
  c.set("userId", session.user.id);
  c.set("db", getDb(c.env.DATABASE_URL));
  await next();
});

/** After a task/profile/calendar change: push it to Google in the background (the cron retries on failure). */
const kickMirror = (c: { env: Env; var: Vars; executionCtx: { waitUntil(p: Promise<unknown>): void } }, profileId: string) => {
  if (!c.env.TOKEN_ENC_KEY || !c.env.GOOGLE_CLIENT_ID) return;
  c.executionCtx.waitUntil(reconcileMirrors(c.var.db, googleClientFor(c.env), { profileId }).catch((e) => console.error("[mirror]", e)));
};

// --- profiles ---------------------------------------------------------------
api.get("/profiles", async (c) =>
  c.json(await c.var.db.select().from(profile).where(eq(profile.userId, c.var.userId)).orderBy(asc(profile.createdAt))),
);

api.post("/profiles", zValidator("json", createProfileInput), async (c) => {
  const [p] = await c.var.db.insert(profile).values({ ...c.req.valid("json"), userId: c.var.userId }).returning();
  return c.json(p, 201);
});

api.patch("/profiles/:id", zValidator("json", updateProfileInput), async (c) => {
  const s = await withProfile(c.var.db, c.var.userId, c.req.param("id"));
  const p = s && (await s.updateSettings(c.req.valid("json")));
  if (p) kickMirror(c, p.id);
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});

api.delete("/profiles/:id", async (c) => {
  const { db, userId } = c.var;
  const [row] = await db.select({ n: count() }).from(profile).where(eq(profile.userId, userId));
  if ((row?.n ?? 0) <= 1) return c.json({ error: "cannot delete the last profile" }, 409);
  const [p] = await db.delete(profile)
    .where(and(eq(profile.id, c.req.param("id")), eq(profile.userId, userId))).returning({ id: profile.id });
  return p ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

// --- tasks (always through withProfile) -------------------------------------
const scoped = async (c: { var: Vars; req: { param(k: string): string } }) =>
  withProfile(c.var.db, c.var.userId, c.req.param("profileId"));
const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ error: "not found" }, 404);

api.get("/profiles/:profileId/tasks", zValidator("query", listTasksQuery), async (c) => {
  const q = c.req.valid("query");
  if ((q.view === "today" || q.view === "upcoming") && !q.dayEnd) return c.json({ error: "dayEnd required" }, 400);
  const s = await scoped(c);
  return s ? c.json(await s.tasks.list(q)) : notFound(c);
});

api.post("/profiles/:profileId/tasks", zValidator("json", createTaskInput), async (c) => {
  const s = await scoped(c);
  if (!s) return notFound(c);
  const t = await s.tasks.create(c.req.valid("json"));
  if (t) kickMirror(c, s.profile.id);
  return t ? c.json(t, 201) : c.json({ error: "invalid parent or id" }, 400);
});

api.patch("/profiles/:profileId/tasks/:id", zValidator("json", updateTaskInput), async (c) => {
  const s = await scoped(c);
  const t = s && (await s.tasks.update(c.req.param("id"), c.req.valid("json")));
  if (t) kickMirror(c, t.profileId);
  return t ? c.json(t) : notFound(c);
});

api.delete("/profiles/:profileId/tasks/:id", async (c) => {
  const s = await scoped(c);
  const removed = s && (await s.tasks.remove(c.req.param("id")));
  if (s && removed) kickMirror(c, s.profile.id);
  return removed ? c.body(null, 204) : notFound(c);
});

// --- calendar ---------------------------------------------------------------
api.get("/profiles/:profileId/calendar", zValidator("query", calendarQuery), async (c) => {
  const { from, to } = c.req.valid("query");
  const s = await scoped(c);
  return s ? c.json(await s.tasks.listRange(new Date(from), new Date(to))) : notFound(c);
});

// --- calendar accounts (Google) ---------------------------------------------
api.get("/profiles/:profileId/calendar-accounts", async (c) => {
  const s = await scoped(c);
  return s ? c.json(await s.calendars.accounts()) : notFound(c);
});

api.post("/profiles/:profileId/calendar-accounts/google/start", zValidator("json", z.object({ platform: z.enum(["web", "desktop"]) })), async (c) => {
  const s = await scoped(c);
  if (!s) return notFound(c);
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET || !c.env.TOKEN_ENC_KEY) {
    return c.json({ error: "Google Calendar isn't configured on the server yet." }, 501);
  }
  const state = await signState({ uid: c.var.userId, pid: s.profile.id, ret: c.req.valid("json").platform }, c.env.BETTER_AUTH_SECRET);
  return c.json({ url: authUrl(c.env, `${c.env.BETTER_AUTH_URL}/oauth/google/callback`, state) });
});

api.post("/profiles/:profileId/calendar-accounts/sync", async (c) => {
  const s = await scoped(c);
  if (!s) return notFound(c);
  const result = await s.calendars.syncNow(c.env);
  kickMirror(c, s.profile.id);
  return c.json(result);
});

api.delete("/profiles/:profileId/calendar-accounts/:id", async (c) => {
  const s = await scoped(c);
  if (!s) return notFound(c);
  const token = await s.calendars.disconnect(c.req.param("id"));
  if (!token) return notFound(c);
  if (c.env.TOKEN_ENC_KEY) c.executionCtx.waitUntil(decryptToken(token, c.env.TOKEN_ENC_KEY, c.env.TOKEN_ENC_KEY_PREVIOUS).then(revokeToken).catch(() => {}));
  return c.body(null, 204);
});

api.patch("/profiles/:profileId/calendars/:id", zValidator("json", z.object({ selected: z.boolean().optional(), isWriteTarget: z.boolean().optional() })), async (c) => {
  const s = await scoped(c);
  const cal = s && (await s.calendars.updateCalendar(c.req.param("id"), c.req.valid("json")));
  if (s && cal) kickMirror(c, s.profile.id);
  return cal ? c.json(cal) : notFound(c);
});

api.get("/profiles/:profileId/calendar/events", zValidator("query", calendarQuery), async (c) => {
  const { from, to } = c.req.valid("query");
  const s = await scoped(c);
  return s ? c.json(await s.calendars.events(new Date(from), new Date(to))) : notFound(c);
});

// --- reminders --------------------------------------------------------------
api.get("/profiles/:profileId/reminders", async (c) => {
  const s = await scoped(c);
  return s ? c.json(await s.reminders.list()) : notFound(c);
});

api.post("/profiles/:profileId/reminders/:id/snooze", zValidator("json", snoozeInput), async (c) => {
  const s = await scoped(c);
  const r = s && (await s.reminders.snooze(c.req.param("id"), c.req.valid("json").minutes));
  return r ? c.json(r) : notFound(c);
});

api.post("/profiles/:profileId/reminders/:id/dismiss", async (c) => {
  const s = await scoped(c);
  const r = s && (await s.reminders.dismiss(c.req.param("id")));
  return r ? c.json(r) : notFound(c);
});

// --- data export ------------------------------------------------------------
api.get("/export", async (c) => {
  const data = await forUser(c.var.db, c.var.userId).exportAll();
  c.header("content-disposition", `attachment; filename="doer-export-${data.exportedAt.slice(0, 10)}.json"`);
  return c.json(data);
});

// --- devices + desktop feed (user-scoped, not profile-scoped) -----------------
api.get("/devices", async (c) => c.json(await forUser(c.var.db, c.var.userId).devices.list()));

api.put("/devices/:id", zValidator("param", z.object({ id: z.uuid() })), zValidator("json", deviceInput), async (c) => {
  const d = await forUser(c.var.db, c.var.userId).devices.upsert(c.req.valid("param").id, c.req.valid("json"));
  return d ? c.json(d) : c.json({ error: "not found" }, 404);
});

api.get("/push/public-key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY ?? null }));

api.put("/devices/:id/push-subscription", zValidator("param", z.object({ id: z.uuid() })), zValidator("json", pushSubscriptionInput), async (c) => {
  const ok = await forUser(c.var.db, c.var.userId).push.set(c.req.valid("param").id, c.req.valid("json"));
  return ok ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

api.delete("/devices/:id/push-subscription", zValidator("param", z.object({ id: z.uuid() })), async (c) => {
  await forUser(c.var.db, c.var.userId).push.clear(c.req.valid("param").id);
  return c.body(null, 204);
});

api.get("/reminders/upcoming", async (c) =>
  c.json(await forUser(c.var.db, c.var.userId).upcomingFor(c.req.query("deviceId"))),
);

app.route("/", api);

// Errors go to Sentry only when SENTRY_DSN is set. No PII (the SDK default), and nothing from requests is attached.
const worker = {
  fetch: app.fetch,
  // Every minute: reminder push dispatch, calendar sync, task mirroring.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = getDb(env.DATABASE_URL);
    ctx.waitUntil(Promise.all([
      dispatchDueReminders(db, env),
      syncDueCalendars(db, env),
      env.TOKEN_ENC_KEY ? reconcileMirrors(db, googleClientFor(env)) : undefined,
      rotateTokenKeys(db, env),
    ]));
  },
};

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.request?.cookies;
      delete event.request?.headers;
      delete event.request?.data;
      delete event.request?.query_string;
      return event;
    },
  }),
  worker,
);
