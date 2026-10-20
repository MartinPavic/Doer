import { and, asc, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "@doer/core/schemas";
import type { Db } from "./db/client";
import { profile, task } from "./db/schema";

const toDate = (v: string | null | undefined) => (v == null ? v : new Date(v));

/**
 * The only way routes touch tenant data: resolves the profile for this user
 * (undefined if it isn't theirs) and returns task queries pinned to it.
 */
export async function withProfile(db: Db, userId: string, profileId: string) {
  const [p] = await db
    .select()
    .from(profile)
    .where(and(eq(profile.id, profileId), eq(profile.userId, userId)));
  if (!p) return undefined;

  const mine = (id: string) =>
    and(eq(task.id, id), eq(task.profileId, p.id), isNull(task.deletedAt));

  return {
    profile: p,
    tasks: {
      async list(q: ListTasksQuery) {
        const live = and(eq(task.profileId, p.id), isNull(task.deletedAt));
        const dayStart = toDate(q.dayStart);
        const dayEnd = toDate(q.dayEnd);
        switch (q.view) {
          case "today": // overdue + due today + undated (quick-added tasks have no due date)
            return db.select().from(task)
              .where(and(live, eq(task.status, "todo"), dayEnd ? or(isNull(task.dueAt), lt(task.dueAt, dayEnd)) : undefined))
              .orderBy(asc(task.dueAt), desc(task.priority), desc(task.createdAt));
          case "upcoming":
            return db.select().from(task)
              .where(and(live, eq(task.status, "todo"), dayEnd ? gte(task.dueAt, dayEnd) : undefined))
              .orderBy(asc(task.dueAt), desc(task.priority));
          case "done":
            return db.select().from(task)
              .where(and(live, eq(task.status, "done"), dayStart ? gte(task.completedAt, dayStart) : undefined))
              .orderBy(desc(task.completedAt));
          default:
            return db.select().from(task).where(live).orderBy(desc(task.createdAt));
        }
      },
      async get(id: string) {
        const [t] = await db.select().from(task).where(mine(id));
        return t;
      },
      async create(input: CreateTaskInput) {
        if (input.parentId && !(await this.get(input.parentId))) return undefined;
        const [t] = await db.insert(task).values({
          ...input,
          startAt: toDate(input.startAt),
          dueAt: toDate(input.dueAt),
          profileId: p.id,
        }).onConflictDoNothing({ target: task.id }).returning();
        // Replayed create: return the existing row, but only if it's ours (get() is profile-scoped).
        return t ?? (input.id ? this.get(input.id) : undefined);
      },
      async update(id: string, input: UpdateTaskInput) {
        const { status, startAt, dueAt, ...rest } = input;
        const [t] = await db.update(task).set({
          ...rest,
          ...(startAt !== undefined && { startAt: toDate(startAt) }),
          ...(dueAt !== undefined && { dueAt: toDate(dueAt) }),
          ...(status !== undefined && {
            status,
            completedAt: status === "done" ? new Date() : null,
          }),
          updatedAt: new Date(),
        }).where(mine(id)).returning();
        return t;
      },
      async remove(id: string) {
        const now = new Date();
        const [t] = await db.update(task)
          .set({ deletedAt: now, updatedAt: now })
          .where(mine(id)).returning({ id: task.id });
        if (t) {
          await db.update(task).set({ deletedAt: now, updatedAt: now })
            .where(and(eq(task.parentId, id), eq(task.profileId, p.id), isNull(task.deletedAt)));
        }
        return !!t;
      },
    },
  };
}
