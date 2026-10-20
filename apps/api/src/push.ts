import { buildPushPayload } from "@block65/webcrypto-web-push";

export type PushEnv = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** "gone" means the browser revoked the subscription (404/410) and it should be deleted. */
export async function sendPush(env: PushEnv, sub: StoredSubscription, data: unknown): Promise<"ok" | "gone" | "error"> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return "error";
  try {
    const payload = await buildPushPayload(
      { data: JSON.stringify(data), options: { ttl: 3600, urgency: "high" } },
      { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      { subject: env.VAPID_SUBJECT ?? "mailto:admin@example.com", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    const res = await fetch(sub.endpoint, payload);
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
