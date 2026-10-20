import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  createProfileInput, createTaskInput, deviceInput, listTasksQuery, pushSubscriptionInput, snoozeInput, updateProfileInput, updateTaskInput,
} from "@doer/core/schemas";
import { allowedOrigins, createAuth, type AuthEnv } from "./auth";
import { getDb, type Db } from "./db/client";
import { profile } from "./db/schema";
import { dispatchDueReminders } from "./dispatch";
import type { PushEnv } from "./push";
import { forUser } from "./user-scope";
import { withProfile } from "./with-profile";

export type Env = AuthEnv & PushEnv;
type Vars = { userId: string; db: Db };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("*", (c, next) =>
  cors({
    origin: allowedOrigins(c.env),
    credentials: true,
    exposeHeaders: ["set-auth-token"],
  })(c, next),
);

app.get("/health", (c) => c.json({ ok: true }));
app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

const api = new Hono<{ Bindings: Env; Variables: Vars }>();
api.use("*", async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  c.set("db", getDb(c.env.DATABASE_URL));
  await next();
});

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
  return t ? c.json(t, 201) : c.json({ error: "invalid parent or id" }, 400);
});

api.patch("/profiles/:profileId/tasks/:id", zValidator("json", updateTaskInput), async (c) => {
  const s = await scoped(c);
  const t = s && (await s.tasks.update(c.req.param("id"), c.req.valid("json")));
  return t ? c.json(t) : notFound(c);
});

api.delete("/profiles/:profileId/tasks/:id", async (c) => {
  const s = await scoped(c);
  return s && (await s.tasks.remove(c.req.param("id"))) ? c.body(null, 204) : notFound(c);
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

export default {
  fetch: app.fetch,
  // Every minute: reminder push dispatch (token refresh and watch renewal join in Phase 6).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchDueReminders(getDb(env.DATABASE_URL), env));
  },
};
