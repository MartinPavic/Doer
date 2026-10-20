import Database from "@tauri-apps/plugin-sql";
import {
  ApiError,
  isRetryable,
  type ApiClient,
  type CreateTaskInput,
  type ListTasksQuery,
  type Profile,
  type Task,
  type UpdateTaskInput,
} from "@doer/core";

/**
 * Read-through SQLite cache + write outbox around the API client.
 *
 * - Reads hit the server and refresh the cache; if the server is unreachable they are served from it.
 *   The Rust reminder scheduler (Phase 4) reads the same `task_cache` table.
 * - Task writes go straight to the server when the outbox is empty. On a network/5xx failure (or while
 *   older writes are still queued, to keep order) they are applied to the cache and queued for replay.
 * - Conflicts: replay is last-writer-wins by server clock. Creates carry client-generated ids, so a
 *   replayed create is idempotent.
 */
type Op =
  | { kind: "create"; profileId: string; input: CreateTaskInput & { id: string } }
  | { kind: "update"; profileId: string; id: string; input: UpdateTaskInput }
  | { kind: "remove"; profileId: string; id: string };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profile_cache (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS task_cache (
     id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
     due_at TEXT, deleted INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS task_cache_profile ON task_cache(profile_id)`,
  `CREATE TABLE IF NOT EXISTS outbox (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
];

const dbPromise = Database.load("sqlite:doer.db").then(async (db) => {
  for (const sql of SCHEMA) await db.execute(sql);
  return db;
});

const upsertTask = async (t: Task, deleted = false) =>
  (await dbPromise).execute(
    `INSERT INTO task_cache (id, profile_id, title, status, due_at, deleted, json) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(id) DO UPDATE SET title=$3, status=$4, due_at=$5, deleted=$6, json=$7`,
    [t.id, t.profileId, t.title, t.status, t.dueAt, deleted ? 1 : 0, JSON.stringify(t)],
  );

async function cachedTasks(profileId: string): Promise<Task[]> {
  const rows = await (await dbPromise).select<{ json: string }[]>(
    `SELECT json FROM task_cache WHERE profile_id=$1 AND deleted=0`,
    [profileId],
  );
  return rows.map((r) => JSON.parse(r.json) as Task);
}

const byDue = (a: Task, b: Task) =>
  (a.dueAt ?? "￿").localeCompare(b.dueAt ?? "￿") || b.priority - a.priority;

/** Mirrors the server's view filters so offline lists look the same as online ones. */
async function localList(profileId: string, q: Partial<ListTasksQuery>): Promise<Task[]> {
  const all = await cachedTasks(profileId);
  const { dayStart, dayEnd } = q;
  switch (q.view) {
    case "today":
      return all.filter((t) => t.status === "todo" && (!t.dueAt || !dayEnd || t.dueAt < dayEnd)).sort(byDue);
    case "upcoming":
      return all.filter((t) => t.status === "todo" && t.dueAt && (!dayEnd || t.dueAt >= dayEnd)).sort(byDue);
    case "done":
      return all
        .filter((t) => t.status === "done" && (!dayStart || (t.completedAt ?? "") >= dayStart))
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    default:
      return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

async function cacheTasks(profileId: string, fresh: Task[], isFullSet: boolean) {
  for (const t of fresh) await upsertTask(t);
  if (!isFullSet) return;
  const keep = new Set(fresh.map((t) => t.id));
  for (const t of await cachedTasks(profileId)) if (!keep.has(t.id)) await upsertTask(t, true);
}

async function applyLocal(op: Op): Promise<Task | undefined> {
  const now = new Date().toISOString();
  if (op.kind === "create") {
    const i = op.input;
    const t: Task = {
      id: i.id, profileId: op.profileId, parentId: i.parentId ?? null, title: i.title, notes: i.notes ?? null,
      status: "todo", priority: i.priority ?? 0, startAt: i.startAt ?? null, dueAt: i.dueAt ?? null,
      allDay: i.allDay ?? false, tz: i.tz ?? null, rrule: i.rrule ?? null, completedAt: null,
      createdAt: now, updatedAt: now,
    };
    await upsertTask(t);
    return t;
  }
  const current = (await cachedTasks(op.profileId)).find((t) => t.id === op.id);
  if (!current) throw new ApiError(404, "not found");
  if (op.kind === "remove") {
    await upsertTask(current, true);
    for (const child of (await cachedTasks(op.profileId)).filter((t) => t.parentId === op.id)) {
      await upsertTask(child, true);
    }
    return undefined;
  }
  const { status, ...rest } = op.input;
  const t: Task = {
    ...current,
    ...rest,
    ...(status && { status, completedAt: status === "done" ? now : null }),
    updatedAt: now,
  };
  await upsertTask(t);
  return t;
}

async function send(api: ApiClient, op: Op): Promise<Task | undefined> {
  switch (op.kind) {
    case "create": return api.tasks.create(op.profileId, op.input);
    case "update": return api.tasks.update(op.profileId, op.id, op.input);
    case "remove": return void (await api.tasks.remove(op.profileId, op.id));
  }
}

const outboxCount = async () =>
  (await (await dbPromise).select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM outbox`))[0]?.n ?? 0;

/** Wipe everything: called on sign-out so the next account never sees this one's data. */
export async function clearOfflineData() {
  const db = await dbPromise;
  for (const t of ["profile_cache", "task_cache", "outbox"]) await db.execute(`DELETE FROM ${t}`);
}

let flushing: Promise<void> | null = null;

async function doFlush(api: ApiClient) {
  const db = await dbPromise;
  for (;;) {
    const [row] = await db.select<{ seq: number; op: string }[]>(`SELECT seq, op FROM outbox ORDER BY seq LIMIT 1`);
    if (!row) return;
    try {
      await send(api, JSON.parse(row.op) as Op);
    } catch (e) {
      // Offline, server down, or signed out: keep the queue and try again later.
      if (isRetryable(e) || (e instanceof ApiError && e.status === 401)) return;
      console.warn("dropping unreplayable outbox op", row.op, e); // e.g. task deleted elsewhere (404)
    }
    await db.execute(`DELETE FROM outbox WHERE seq=$1`, [row.seq]);
  }
}

export function withOfflineSupport(api: ApiClient): ApiClient {
  const flush = () => (flushing ??= doFlush(api).finally(() => (flushing = null)));
  window.addEventListener("online", () => void flush());
  void flush();

  async function mutate(op: Op): Promise<Task | undefined> {
    if ((await outboxCount()) === 0) {
      try {
        const result = await send(api, op);
        if (result) await upsertTask(result);
        else await applyLocal(op).catch(() => {}); // remove: reflect locally
        return result;
      } catch (e) {
        if (!isRetryable(e)) throw e;
      }
    }
    const local = await applyLocal(op);
    await (await dbPromise).execute(`INSERT INTO outbox (op) VALUES ($1)`, [JSON.stringify(op)]);
    return local;
  }

  return {
    profiles: {
      ...api.profiles,
      async list() {
        try {
          const profiles = await api.profiles.list();
          const db = await dbPromise;
          for (const p of profiles) {
            await db.execute(
              `INSERT INTO profile_cache (id, json) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET json=$2`,
              [p.id, JSON.stringify(p)],
            );
          }
          return profiles;
        } catch (e) {
          if (!isRetryable(e)) throw e;
          const rows = await (await dbPromise).select<{ json: string }[]>(`SELECT json FROM profile_cache`);
          if (rows.length === 0) throw e;
          return rows.map((r) => JSON.parse(r.json) as Profile).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
      },
    },
    tasks: {
      async list(profileId, q) {
        await flush();
        if ((await outboxCount()) === 0) {
          try {
            const fresh = await api.tasks.list(profileId, q);
            await cacheTasks(profileId, fresh, q.view === "all");
            return fresh;
          } catch (e) {
            if (!isRetryable(e)) throw e;
          }
        }
        return localList(profileId, q);
      },
      create: async (profileId, input) =>
        (await mutate({ kind: "create", profileId, input: { ...input, id: input.id ?? crypto.randomUUID() } }))!,
      update: async (profileId, id, input) => (await mutate({ kind: "update", profileId, id, input }))!,
      remove: async (profileId, id) => void (await mutate({ kind: "remove", profileId, id })),
    },
  };
}
