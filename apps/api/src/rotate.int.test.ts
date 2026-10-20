// Needs a real database: node --env-file=.dev.vars node_modules/vitest/vitest.mjs run rotate.int
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotateTokenKeys } from "./calendar-service";
import { decryptToken, encryptToken } from "./crypto";
import { getDb } from "./db/client";
import { calendarAccount, profile, user } from "./db/schema";

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
const newKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

d("token key rotation (real DB)", () => {
  const db = getDb(url ?? "postgres://x");
  const uid = `inttest-${crypto.randomUUID()}`;
  const OLD = newKey();
  const NEW = newKey();
  let pid = "";
  const ids: string[] = [];

  beforeAll(async () => {
    await db.insert(user).values({ id: uid, name: "r", email: `${uid}@example.com` });
    pid = (await db.insert(profile).values({ userId: uid, name: "P", kind: "private" }).returning())[0]!.id;
    for (const [email, key, token] of [["old@x.com", OLD, "rt-old"], ["new@x.com", NEW, "rt-new"]] as const) {
      const a = (await db.insert(calendarAccount).values({ profileId: pid, provider: "google", externalEmail: email, refreshTokenEnc: await encryptToken(token, key), scopes: "s" }).returning())[0]!;
      ids.push(a.id);
    }
  });
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, uid));
  });

  const stored = async (id: string) => (await db.select().from(calendarAccount).where(eq(calendarAccount.id, id)))[0]!.refreshTokenEnc;

  it("does nothing without a previous key", async () => {
    expect(await rotateTokenKeys(db, { TOKEN_ENC_KEY: NEW })).toBe(0);
    await expect(decryptToken(await stored(ids[0]!), NEW)).rejects.toThrow(); // still under the old key
  });

  it("re-encrypts tokens still under the previous key and leaves current ones alone", async () => {
    const before = await stored(ids[1]!);
    const n = await rotateTokenKeys(db, { TOKEN_ENC_KEY: NEW, TOKEN_ENC_KEY_PREVIOUS: OLD });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await decryptToken(await stored(ids[0]!), NEW)).toBe("rt-old"); // now readable with only the new key
    expect(await stored(ids[1]!)).toBe(before); // untouched
  });

  it("is finished once everything is rotated", async () => {
    const mine = async () => (await rotateTokenKeys(db, { TOKEN_ENC_KEY: NEW, TOKEN_ENC_KEY_PREVIOUS: OLD }, 100));
    await mine(); // (other tests' rows may also rotate)
    await expect(decryptToken(await stored(ids[0]!), NEW)).resolves.toBe("rt-old");
    await expect(decryptToken(await stored(ids[1]!), NEW)).resolves.toBe("rt-new");
  });
});
