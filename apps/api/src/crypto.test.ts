import { describe, expect, it } from "vitest";
import { decryptToken, decryptTokenRotating, encryptToken } from "./crypto";
import { signState, verifyState } from "./signed-state";

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("token encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const stored = await encryptToken("1//refresh-token-secret", KEY);
    expect(stored).not.toContain("refresh-token");
    expect(await decryptToken(stored, KEY)).toBe("1//refresh-token-secret");
  });
  it("uses a fresh IV each time", async () => {
    expect(await encryptToken("same", KEY)).not.toBe(await encryptToken("same", KEY));
  });
  it("fails with the wrong key or tampered data", async () => {
    const stored = await encryptToken("x", KEY);
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(decryptToken(stored, other)).rejects.toThrow();
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1]! ^= 1;
    await expect(decryptToken(btoa(String.fromCharCode(...bytes)), KEY)).rejects.toThrow();
  });
  it("rejects a key of the wrong length", async () => {
    await expect(encryptToken("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});

describe("key rotation", () => {
  const newKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  it("reads old data with the previous key and flags it for re-encryption", async () => {
    const old = await encryptToken("rt", KEY);
    expect(await decryptTokenRotating(old, newKey, KEY)).toEqual({ plain: "rt", usedPrevious: true });
    const fresh = await encryptToken("rt", newKey);
    expect(await decryptTokenRotating(fresh, newKey, KEY)).toEqual({ plain: "rt", usedPrevious: false });
  });
  it("fails when neither key matches, or when there is no previous key", async () => {
    const old = await encryptToken("rt", KEY);
    const third = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await expect(decryptTokenRotating(old, newKey, third)).rejects.toThrow();
    await expect(decryptToken(old, newKey)).rejects.toThrow();
  });
});

describe("signed state", () => {
  const secret = "s".repeat(32);
  it("verifies its own payload", async () => {
    const s = await signState({ uid: "u1", pid: "p1" }, secret);
    expect(await verifyState<{ uid: string; pid: string }>(s, secret)).toMatchObject({ uid: "u1", pid: "p1" });
  });
  it("rejects tampering, wrong secret, garbage and expiry", async () => {
    const s = await signState({ uid: "u1" }, secret);
    const [body, sig] = s.split(".");
    const forged = btoa(JSON.stringify({ uid: "admin", exp: 9e9 })).replace(/=+$/, "");
    expect(await verifyState(`${forged}.${sig}`, secret)).toBeNull();
    expect(await verifyState(s, "other-secret".repeat(3))).toBeNull();
    expect(await verifyState("garbage", secret)).toBeNull();
    expect(await verifyState(`${body}.`, secret)).toBeNull();
    expect(await verifyState(await signState({ uid: "u1" }, secret, -1), secret)).toBeNull();
  });
});
