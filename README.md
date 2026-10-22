# Doer

A daily task tracker with separate **Work** and **Private** profiles, reminders, a calendar view and Google Calendar sync. It runs as a **web app** and a **macOS desktop app** that share one codebase and one account.

## Features

- **Profiles:** keep work and private tasks apart. Switch with the profile tabs or **Option+Tab** (Shift reverses).
- **Tasks:** quick add, due dates, repeat rules, notes, subtasks in the data model, drag to reorder.
- **Reminders:** per-task lead times, quiet hours, snooze/dismiss. The desktop app sends native notifications; the web app uses Web Push.
- **Calendar view:** past and future tasks, recurring tasks expanded per occurrence, other profiles overlaid read-only.
- **Google Calendar:** connect an account per profile, show its events, and mirror timed tasks into a calendar you can write to (per profile default, overridable per task).
- **Floating bubble (macOS):** an always-on-top circle that opens a quick-add panel (**Option+Space**).
- **Offline (desktop):** reads fall back to a local SQLite cache, and writes queue until the server is reachable.
- **Your data stays yours:** Settings → Export everything downloads a JSON copy.

Not built yet: Google edits flowing back into tasks, and Outlook. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the status of each phase.

## Architecture

```
Web (React + Vite) ──┐
                     ├─ HTTPS ─▶ API (Hono on Cloudflare Workers) ─▶ Neon Postgres
Desktop (Tauri) ─────┘                  └─ cron, every minute: reminders, calendar sync, task mirroring
```

| Path | What it is |
|---|---|
| `apps/api` | Hono API on Cloudflare Workers: auth (Better Auth), tasks, reminders, Google Calendar, cron. Drizzle schema and migrations. |
| `apps/web` | Web shell (Vite, PWA). |
| `apps/desktop` | Tauri 2 shell: main window, bubble window, notifications, offline cache. |
| `packages/ui` | Shared React UI: task list, calendar, settings. |
| `packages/core` | API client, TanStack Query hooks, zod schemas, shared types, recurrence and reminder logic. |
| `packages/config` | Shared TypeScript config. |

Stack: React 19, Tailwind, TanStack Query, Zustand, FullCalendar, Hono, Drizzle, Neon, Tauri 2, pnpm + Turborepo.

## Getting started

**Prerequisites:** Node 24, pnpm 10, a [Neon](https://neon.com) Postgres database. For the desktop app also Rust and the Xcode command line tools.

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # then fill it in (below)
cd apps/api && DATABASE_URL="<your url>" pnpm db:migrate && cd ../..
pnpm dev            # web on :5173, API on :8787
pnpm dev:desktop    # desktop app (needs `pnpm dev`'s API running)
```

`drizzle-kit` reads `DATABASE_URL` from the environment, not from `.dev.vars`, so pass it as shown. Re-run `db:migrate` after pulling changes that add a migration in `apps/api/drizzle/`.

### Configuration (`apps/api/.dev.vars`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. |
| `BETTER_AUTH_SECRET` | Session signing secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | The API's public URL (`http://localhost:8787` locally). |
| `WEB_ORIGIN` | The web app's origin (`http://localhost:5173` locally). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client. Needed for Google Calendar and optional Google sign-in. |
| `TOKEN_ENC_KEY` | Encrypts stored Google refresh tokens (`openssl rand -base64 32`). |
| `COOKIE_DOMAIN` | Production only, when web and API sit on sibling subdomains. |
| `SENTRY_DSN` | Optional error reporting. Nothing is sent when empty. |
| `TOKEN_ENC_KEY_PREVIOUS` | Only during key rotation; see the comments in `.dev.vars.example`. |

The web app reads `VITE_API_URL` and `VITE_SENTRY_DSN` (see `apps/web/.env.example`). Leave `VITE_API_URL` empty in development; Vite proxies to the local API.

### Connecting Google Calendar

1. Create a Google OAuth client and put its id and secret in `.dev.vars`. The app requests `calendar.events` and `calendar.calendarlist.readonly`.
2. In the app: Settings → **Connect Google Calendar** and approve in your browser. Do this once per profile.
3. To mirror tasks into Google, pick a calendar under **Add my timed tasks to**. Only calendars you own or can edit are listed. Tasks with a due date then show a 🗓️ toggle for per-task control.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Web and API in watch mode. |
| `pnpm dev:desktop` | Tauri desktop app in dev mode. |
| `pnpm build` | Build everything. |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check all packages. |
| `pnpm test` | Unit tests. |

Database-backed integration tests (`*.int.test.ts` in `apps/api`) are skipped unless `DATABASE_URL` is set. Run one against a **dev** database with:

```sh
cd apps/api && node --env-file=.dev.vars node_modules/vitest/vitest.mjs run export.int
```

## Deploying and releasing

CI (`.github/workflows`) lints, type-checks, tests and builds on pushes to `main` and on pull requests. Pushes to `main` also apply migrations, deploy the API Worker and publish the web app to Cloudflare Pages. A `v*` tag builds, signs and notarizes the macOS app and publishes it to GitHub Releases, from where the app auto-updates.

Account setup (Neon, Cloudflare, Apple, GitHub secrets) is covered step by step in [docs/RELEASING.md](docs/RELEASING.md).
