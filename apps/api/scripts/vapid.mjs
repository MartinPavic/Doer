// Prints a fresh VAPID key pair as .dev.vars lines:  pnpm --filter @doer/api vapid >> apps/api/.dev.vars
import { webcrypto } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", publicKey)); // 0x04 || X || Y

console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
