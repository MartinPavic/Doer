# Doer — Implementation Plan

## 1. Context

Doer is a daily task tracker delivered as a **Mac desktop app (Tauri)** and a **web app (React)** sharing one codebase and one account.

Required features:
1. **Floating bubble** on macOS (Messenger "chat head" style) that expands into a quick task panel.
2. **Calendar view** of past and future tasks, with **two-way sync** to Google Calendar and Outlook.
3. **Separate profiles** for work and private tasks.
4. **Reminders and notifications.**

Decisions already made: Neon Postgres for hosting data, floating-circle bubble, two-way calendar sync, Mac + web only.

Versions (checked Oct 2026): Tauri **2.12.x** ([release page](https://tauri.app/release/core/)), React **19.3.x** ([react.dev](https://react.dev/blog/2026/09/09/react-19-3)). Local toolchain already present: Node 24, Rust 1.98, Xcode CLT.

## 2. Architecture

```
┌────────────────┐   ┌────────────────┐
│ Web (React/Vite)│   │ Desktop (Tauri) │  ← same React UI package
│  Cloudflare Pages│   │  main + bubble  │
└───────┬────────┘   └───────┬────────┘
        │  HTTPS (cookie)     │  HTTPS (bearer, token in Keychain)
        └──────────┬──────────┘
            ┌──────▼───────┐   cron (1 min): reminders, token refresh,
            │ API (Hono on  │   calendar-watch renewal
            │ CF Workers)   │◄── Google / Microsoft webhooks
            └──────┬───────┘
                   │ @neondatabase/serverless + Drizzle
            ┌──────▼───────┐
            │ Neon Postgres │
            └───────────────┘
```

Key choices and why:

| Area | Choice | Reason |
|---|---|---|
| Backend | Hono API on **Cloudflare Workers** | Neon is Postgres only — no API/realtime — so an API is required. Workers cron triggers run every minute (needed for reminders); Vercel Hobby cron cannot. |
| ORM | Drizzle + `drizzle-kit` migrations | Typed, Workers/Neon-friendly. |
| App auth | **Self-hosted Better Auth** in the API (email/password + Google sign-in) | Neon's managed Auth doesn't accept custom plugins/handlers yet ([Neon blog](https://neon.com/blog/neon-auth-branchable-identity-in-your-database)); we need control over OAuth tokens and the bearer plugin for desktop. |
| Calendar OAuth | Separate "connected accounts" flow, **not** tied to login | A user can connect work Outlook to the Work profile and Gmail to Private. Refresh tokens stay server-side, encrypted (AES-GCM, key in Worker secret). Clients never see them. |
| Frontend | React 19.3, Vite, TypeScript, TanStack Router + Query, Zustand (UI state), Tailwind + shadcn/ui, FullCalendar (calendar view), `rrule` (recurrence) | Mature, minimal custom code. |
| Desktop | Tauri 2.12 + plugins: `notification`, `autostart`, `global-shortcut`, `deep-link`, `single-instance`, `window-state`, `positioner`, `updater`, `sql` (SQLite cache), `opener` | First-party, covers all needs. |
| Desktop session | Bearer token in macOS Keychain (Rust `keyring` crate behind a Tauri command) | Webview origin is `tauri://localhost`; cross-origin cookies are unreliable. |
| Monorepo | pnpm workspaces + Turborepo | One UI package, two shells. |

### Repo layout

```
Doer/
  apps/
    web/            Vite SPA shell (routing, service worker, PWA manifest)
    desktop/        Tauri shell (src-tauri/, bubble window entry)
    api/            Hono Worker (routes, cron, webhooks, Drizzle schema + migrations)
  packages/
    ui/             Shared React components (task list, calendar, profile switcher)
    core/           API client, TanStack Query hooks, zod schemas, platform adapter interface
    config/         tsconfig, eslint, tailwind presets
  IMPLEMENTATION_PLAN.md
```

`packages/core` defines a `Platform` interface (`notify()`, `secureStore`, `openExternal()`, `isDesktop`) implemented separately by web and desktop. This is the only place platform differences leak into shared code.

## 3. Data model (Neon / Postgres)

All times stored as `timestamptz` (UTC) plus an IANA `tz` string where the user's intent is local (recurring tasks, all-day).

- `user` (Better Auth managed), `session`, `account`
- `profile` — `id, user_id, name, kind ('work'|'private'), color, quiet_hours jsonb, default_reminder_offset, created_at`
- `task` — `id, profile_id, title, notes, status ('todo'|'done'|'cancelled'), priority, start_at, due_at, all_day, tz, rrule, parent_id, completed_at, created_at, updated_at, deleted_at`
- `reminder` — `id, task_id, fire_at (absolute, precomputed), offset_minutes, channels text[], fired_at, dismissed_at`
- `calendar_account` — `id, profile_id, provider ('google'|'microsoft'), external_email, refresh_token_enc, scopes, status, created_at`
- `calendar` — `id, account_id, external_id, name, selected bool, is_write_target bool, sync_token/delta_link, watch_channel_id, watch_expires_at`
- `calendar_event` — cached external events: `id, calendar_id, external_id, etag, title, start_at, end_at, all_day, rrule, raw jsonb, deleted_at`
- `task_calendar_link` — `task_id, calendar_id, external_event_id, etag, last_synced_at` (mirror of a task as an event)
- `push_subscription` — `id, user_id, endpoint, keys, device_label`
- `device` — `id, user_id, kind ('web'|'desktop'), notify_here bool, last_seen_at`

**Profile isolation:** every tenant table is reached through `profile_id`; the API exposes a single `withProfile(userId, profileId)` query helper that all routes must use. Add Postgres RLS policies as a second layer once the schema stabilises (Phase 8).

## 4. Feature designs

### 4.1 Mac bubble

Second Tauri window `bubble` (own HTML entry, same React package), configured in `tauri.conf.json`:
`decorations: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `visibleOnAllWorkspaces: true`, `shadow: false`; `app.macOSPrivateApi: true` (required for transparency).

Behaviour:
- **Collapsed:** 56×56 circle showing active-profile colour and a badge (overdue + due today count).
- **Click** (movement < 4 px) → expand to ~360×520 panel anchored to the bubble's corner nearest screen centre; contents: add-task input, today's tasks, profile switcher, "open Doer" button. Click outside / `Esc` / losing focus → collapse.
- **Drag** → custom drag handler calling `window.setPosition`; on release, snap to nearest left/right screen edge and persist position (`window-state` + per-display clamp). `data-tauri-drag-region` alone cannot distinguish click from drag, so use manual pointer handling.
- **Global shortcut** (default `⌥Space`) toggles expanded state / focuses add-task input.
- Menu-bar tray icon as a fallback and to quit/hide the bubble; optional "hide Dock icon" (`ActivationPolicy::Accessory`).
- Bubble and main window talk through Tauri events (`task:changed`, `profile:changed`) plus the shared TanStack Query cache invalidation via API refetch.

Known risks:
- Showing the bubble above **full-screen apps** needs an `NSPanel`-style window; plain Tauri windows can't. Mitigation: evaluate the community `tauri-nspanel` plugin in the Phase 3 spike; accept "not over full-screen apps" if it proves fragile.
- `macOSPrivateApi` disqualifies the Mac App Store. Distribution is notarized DMG + Tauri updater instead (fine for a personal tool).

### 4.2 Profiles (work / private)

- A user has ≥1 profiles; created at onboarding (Work, Private). Colour-coded; switcher in main window sidebar and bubble.
- Tasks, reminders, and calendar accounts belong to exactly one profile. Calendar views show the active profile by default with an optional "overlay other profile" toggle (read-only, dimmed).
- Per-profile settings: quiet hours / work-hours schedule (e.g. no Work notifications after 18:00 or weekends), default reminder offset, default calendar write-target.
- Global shortcut and bubble always add to the **active** profile.

### 4.3 Calendar view + integrations

**View:** FullCalendar (month / week / day / agenda) rendering tasks (checkable, draggable to reschedule) and external events (read-only styling, with provider icon). Date-range queries hit `GET /calendar?profileId&from&to`, which merges tasks (with `rrule` expansion server- or client-side via `rrule`) and cached `calendar_event` rows. Past tasks remain visible with completion state.

**Google (Calendar API v3):**
- OAuth 2.0 code flow initiated by the API; scopes `calendar.events`, `calendar.calendarlist.readonly`, `offline_access` via `access_type=offline&prompt=consent`.
- Initial full sync, then **incremental sync with `syncToken`**; push notifications via `events.watch` webhooks (channels expire ≈7 days → cron renews). Fallback polling every 5 min when the app is open.
- **Gotcha:** an OAuth app in "Testing" status issues refresh tokens that expire after 7 days. Publish to "In production" (unverified, ≤100 users, shows a warning screen) for personal use, or use an Internal app if the work account is Google Workspace.

**Outlook (Microsoft Graph):**
- Entra app registration, multi-tenant + personal accounts, scopes `Calendars.ReadWrite offline_access User.Read`.
- `events/delta` for incremental sync; Graph change-notification subscriptions (short-lived, cron renews).
- **Gotcha:** a corporate tenant may block user consent and require admin approval. Test with the work tenant early (Phase 7 starts with this check); fallback is a personal outlook.com account or requesting admin consent.

**Two-way semantics:**
- External → Doer: events appear on the calendar read-only. If an event is linked to a task (`task_calendar_link`), time/title edits update the task.
- Doer → external: tasks with a time are mirrored as events into the profile's write-target calendar when **mirroring is on** (per profile default, per-task override). Completing a task marks the event title `✓` (no delete). Deleting a task deletes its event.
- Conflict rule: compare `etag`/`updated`; last writer wins, but never overwrite an external edit newer than `last_synced_at` without re-pulling first. Echo suppression: ignore webhook changes whose etag matches what we just wrote.
- Recurring items: pass `RRULE` through unchanged; editing a single instance creates an exception event (v1 may restrict to "edit entire series" for mirrored tasks — decision in Phase 6).

### 4.4 Reminders and notifications

Reliability is the hard part: **Tauri's notification plugin cannot schedule on desktop** (scheduling is mobile-only), and web pages can't fire timers when closed. So:

- **Desktop:** Rust-side scheduler (tokio task in `src-tauri`) reads upcoming `reminder` rows from the local SQLite cache and fires native notifications at `fire_at`. App launches at login (`autostart`) and lives in the tray, so the scheduler is always running. Notification actions: **Done**, **Snooze 10 min**, **Open**. Cache is refreshed on every sync and on a 60 s heartbeat.
- **Web:** Web Push (VAPID) with a service worker. The Workers **cron (every minute)** selects `reminder WHERE fire_at <= now() AND fired_at IS NULL`, sends pushes to the user's `push_subscription`s for devices with `notify_here = true`, sets `fired_at`.
- **Dedup across devices:** each device has a `notify_here` flag; default desktop = true, web = false (web push only for when the desktop isn't in use — user toggles). Dismiss/snooze/done syncs via API and clears the other device's pending notification.
- **Rules:** reminders = offset from `due_at` (default per profile) or absolute time; snooze creates a new `fire_at`; quiet hours defer (not drop) reminders to the end of the window; all-day tasks remind at a configurable local time (default 09:00).
- **Overdue digest:** a morning summary notification per profile (optional).
- Notification permission flow in onboarding on both platforms.

### 4.5 Sync and offline (scope control)

- v1: **online-first**. Web is purely online. Desktop keeps a read-through SQLite cache (needed for the reminder scheduler and fast bubble open) and a simple **outbox** for writes made while offline; replay on reconnect.
- Conflicts on tasks: last-writer-wins by `updated_at` (server clock). Acceptable for a single-user app.
- Cross-device freshness: TanStack Query refetch on focus + 30 s polling while visible. SSE/WebSocket is a later upgrade, not v1.

## 5. Phases

Rough effort for one developer with Claude Code assistance; each phase ends with something runnable.

| # | Phase | Deliverable | Est. |
|---|---|---|---|
| 0 | **Scaffold** | pnpm/Turborepo monorepo; `apps/web` (Vite+React 19.3), `apps/desktop` (`create-tauri-app`, Tauri 2.12), `apps/api` (Hono + Wrangler); Neon project + branch per env; Drizzle migrations; CI (lint, typecheck, test) | 2–3 d |
| 1 | **Core tasks + auth + profiles** | Better Auth (email/password + Google sign-in); profile CRUD and switcher; task CRUD, subtasks, priorities, today/upcoming lists; web usable end to end; deployed to Cloudflare | 1–1.5 wk |
| 2 | **Desktop shell** | Tauri main window running shared UI; Platform adapter; Keychain bearer-token login; tray icon; single-instance; autostart; SQLite cache + outbox | 1 wk |
| 3 | **Bubble** | Bubble window (spike first: transparency, all-Spaces, full-screen behaviour, `tauri-nspanel` evaluation); collapse/expand, drag + edge-snap, badge, global shortcut, quick add | 1 wk |
| 4 | **Reminders** | `reminder` model + UI; Rust scheduler + native notifications with actions; Web Push + cron dispatcher; snooze; quiet hours; per-device `notify_here` | 1–1.5 wk |
| 5 | **Calendar view** | FullCalendar month/week/day/agenda; drag-to-reschedule; recurrence (`rrule`); past/future navigation; profile overlay | 1 wk |
| 6 | **Google integration** | Connected-accounts OAuth (system browser + `doer://` deep link on desktop); calendar list/selection; incremental sync + webhooks + renewal cron; read overlay, then task mirroring and two-way edits | 1.5–2 wk |
| 7 | **Outlook integration** | Check work-tenant consent first; Graph delta sync + subscriptions; reuse provider interface from Phase 6 (`CalendarProvider { list, sync, upsert, delete, watch }`) | 1 wk |
| 8 | **Hardening and release** | Postgres RLS; token-encryption key rotation; rate limits; error/Sentry; Apple Developer signing + notarization; DMG + updater on GitHub Releases; PWA manifest; backup/export (JSON) | 1 wk |

Ordering rationale: Phase 3 (bubble) is the riskiest UI; Phase 4 needs the desktop shell. Google (6) precedes Outlook (7) so the provider abstraction is proven on the better-documented API.

## 6. Testing

- **Unit:** Vitest for `core` and API logic (reminder time computation, quiet-hour deferral, rrule expansion, conflict resolution); `cargo test` for the Rust scheduler (inject a fake clock).
- **API integration:** Vitest against a Neon **branch** per CI run; mocked Google/Graph HTTP via MSW.
- **Web E2E:** Playwright (auth, task CRUD, profile switch, calendar navigation).
- **Desktop:** `tauri-driver` WebDriver does **not** support macOS, so no automated desktop E2E. Use a written manual checklist (bubble drag/snap/expand, notification actions, relaunch persistence, sleep/wake reminder firing) run before each release.
- **Calendar:** manual sandbox pass against a real Google account and an Outlook account, including webhook echo loops and token revocation.

## 7. Verification (end to end, before calling v1 done)

1. `pnpm dev` runs web + API + Neon dev branch; sign up, create Work and Private profiles, add tasks, confirm tasks never leak across profiles.
2. `pnpm tauri dev`: login persists via Keychain across restart; bubble appears on all Spaces, drags and snaps to edges, expands/collapses, quick-adds a task that shows up in the web app within ~30 s.
3. Create a task due in 2 min with a reminder: native notification fires on desktop with Done/Snooze actions; with `notify_here` on web and desktop closed, a push arrives.
4. Quiet hours: reminder set inside the window fires at window end.
5. Connect Google and Outlook: events appear; create a task with a time → event appears in the provider; edit the event in the provider → task updates; delete both ways; no echo loop.
6. Let a watch channel/subscription expire in a test → cron renews it; revoke token → account shows "reconnect" state rather than failing silently.
7. `pnpm tauri build` → signed, notarized DMG installs on a clean Mac; updater picks up a newer release.

## 8. Open questions and risks

- **Work Outlook/Google consent** may need IT/admin approval — check in Phase 6/7 start, not at the end.
- **Bubble over full-screen apps** may not be achievable without `NSPanel` (see 4.1).
- **Reminders require the desktop app to be running**; if the user quits it, only web push remains. Mitigation: autostart, tray, and a server-side push fallback option per device.
- **Data sensitivity:** work task titles and calendar data live in a personal Neon database. If Zanders policy restricts work data in personal infrastructure, keep Work-profile calendar integration read-only or local-only. Confirm before Phase 7.
- **Google "unverified app"** warning / 100-user cap is acceptable for personal use only.
- Tauri 3 alpha builds are rumoured but unconfirmed; stay on 2.12.x.
- Out of scope for v1: mobile apps, Windows/Linux builds, shared/team tasks, attachments, realtime push (SSE/WebSocket), full offline editing on web.
