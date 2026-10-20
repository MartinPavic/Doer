// AES-256-GCM for OAuth refresh tokens at rest. Key: TOKEN_ENC_KEY (base64, 32 bytes) as a Worker secret.
// Stored format: base64( 12-byte IV || ciphertext+tag ).

const b64 = {
  enc: (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function key(keyB64: string) {
  const raw = b64.dec(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(keyB64), new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64.enc(out);
}

async function decryptWith(stored: string, keyB64: string): Promise<string> {
  const raw = b64.dec(stored);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(keyB64), raw.slice(12));
  return new TextDecoder().decode(pt);
}

/**
 * Key rotation: set TOKEN_ENC_KEY to the new key and TOKEN_ENC_KEY_PREVIOUS to the old one. Reads try the
 * current key, then the previous; `usedPrevious` tells the caller to re-encrypt with the current one.
 * Once nothing reports `usedPrevious` any more (the cron rotates them all), the previous key can be removed.
 */
export async function decryptTokenRotating(stored: string, keyB64: string, previousB64?: string): Promise<{ plain: string; usedPrevious: boolean }> {
  try {
    return { plain: await decryptWith(stored, keyB64), usedPrevious: false };
  } catch (e) {
    if (!previousB64) throw e;
    return { plain: await decryptWith(stored, previousB64), usedPrevious: true };
  }
}

export async function decryptToken(stored: string, keyB64: string, previousB64?: string): Promise<string> {
  return (await decryptTokenRotating(stored, keyB64, previousB64)).plain;
}
