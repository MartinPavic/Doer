import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { getDb } from "./db/client";
import * as schema from "./db/schema";

const DEFAULT_PROFILES = [
  { name: "Work", kind: "work", color: "#2563eb" },
  { name: "Private", kind: "private", color: "#16a34a" },
] as const;

export type AuthEnv = {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

/** Browser/webview origins allowed to call the API (CORS + Better Auth trusted origins). */
export const allowedOrigins = (env: AuthEnv) => [
  env.WEB_ORIGIN,
  "tauri://localhost", // desktop webview (production build)
  "http://tauri.localhost",
  // `tauri dev` serves the webview from Vite; only when the API itself is local.
  ...(env.BETTER_AUTH_URL.startsWith("http://localhost") ? ["http://localhost:1420"] : []),
];

// Built per request: Workers have no module-level env.
export const createAuth = (env: AuthEnv) => {
  const db = getDb(env.DATABASE_URL);
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: allowedOrigins(env),
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    plugins: [bearer()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.insert(schema.profile).values(DEFAULT_PROFILES.map((p) => ({ ...p, userId: user.id })));
          },
        },
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
