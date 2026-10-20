# Releasing Doer

Three things ship separately: the **API** (Cloudflare Worker), the **web app** (Cloudflare Pages) and the
**macOS app** (signed + notarized, auto-updating from GitHub Releases). Everything runs from GitHub Actions
once the accounts below exist. Do the steps in order; each is needed only once.

Pick your domain first. The web app and API must share a parent domain so the login cookie works, e.g.
`app.example.com` (web) and `api.example.com` (API). Replace `example.com` below.

## 1. GitHub repository
1. Create an empty **private** repository at github.com/new (no README).
2. In the project folder: `git remote add origin git@github.com:YOU/doer.git`, then `git push -u origin main`.

## 2. Production database (Neon)
1. In the Neon project, use the default `main` branch as production (keep `dev` for development).
2. Copy its **pooled connection string**. This is `DATABASE_URL` for production.
3. Backups: Neon keeps point-in-time history (restore from the console). In-app, **Settings → Export everything**
   downloads a JSON copy of your data whenever you want one.

## 3. Cloudflare (API + web)
1. Create a free account at dash.cloudflare.com and add your domain (or buy one there).
2. **Worker secrets**: create a file `secrets.json` (outside the repo, delete it afterwards):
   ```json
   {
     "DATABASE_URL": "postgres://…pooled production string…",
     "BETTER_AUTH_SECRET": "<openssl rand -base64 32>",
     "BETTER_AUTH_URL": "https://api.example.com",
     "WEB_ORIGIN": "https://app.example.com",
     "COOKIE_DOMAIN": "example.com",
     "TOKEN_ENC_KEY": "<openssl rand -base64 32>",
     "GOOGLE_CLIENT_ID": "…",
     "GOOGLE_CLIENT_SECRET": "…",
     "VAPID_PUBLIC_KEY": "…", "VAPID_PRIVATE_KEY": "…", "VAPID_SUBJECT": "mailto:you@example.com",
     "SENTRY_DSN": ""
   }
   ```
   Generate VAPID keys with `pnpm --filter @doer/api vapid`. Then: `pnpm --filter @doer/api exec wrangler login`
   and `pnpm --filter @doer/api exec wrangler secret bulk secrets.json`. Use a *new* `BETTER_AUTH_SECRET` and
   `TOKEN_ENC_KEY` for production, never the dev ones.
3. **API domain**: after the first deploy, Workers & Pages → `doer-api` → Settings → Domains & Routes → add
   `api.example.com`.
4. **Web project**: Workers & Pages → Create → Pages → "Direct Upload", name it exactly `doer-web`. After the first
   deploy add the custom domain `app.example.com`.
5. **API token for CI**: My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers", add the
   permission *Account → Cloudflare Pages → Edit*. Copy it, plus your Account ID (right sidebar of any zone).
6. **Google**: in the Google Cloud console add the redirect URI `https://api.example.com/oauth/google/callback`
   to your OAuth client, and make sure the consent screen is **published** (otherwise refresh tokens expire after 7 days).

## 4. Apple Developer (signing + notarization)
Without this macOS shows "cannot be opened because the developer cannot be verified".
1. Enroll at developer.apple.com/programs (USD 99/year; approval can take a day or two).
2. Xcode → Settings → Accounts → your team → **Manage Certificates** → **+** → **Developer ID Application**.
3. Keychain Access → My Certificates → right-click that certificate → Export → `.p12`, choose a password.
4. `base64 -i certificate.p12 | pbcopy` copies the value for `APPLE_CERTIFICATE`.
5. `APPLE_SIGNING_IDENTITY` is the certificate's full name, e.g. `Developer ID Application: Your Name (ABCDE12345)`
   (`security find-identity -v -p codesigning` lists it). `APPLE_TEAM_ID` is the 10 characters in brackets.
6. `APPLE_ID` is your Apple ID email. For `APPLE_APP_SPECIFIC_PASSWORD`: appleid.apple.com → Sign-In and Security →
   App-Specific Passwords → generate one named "doer-notarize".

## 5. Update-signing key (Tauri, unrelated to Apple)
1. `pnpm --filter @doer/desktop tauri signer generate -w ~/.tauri/doer-updater.key`, choose a password.
2. **Back this key up** (password manager). If you lose it, installed apps can never be updated again.
3. The `.key` file contents → `TAURI_SIGNING_PRIVATE_KEY`; its password → `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
   the `.key.pub` contents → `TAURI_UPDATER_PUBKEY`.

## 6. GitHub secrets and variables
Repository → Settings → Secrets and variables → Actions.

| Kind | Name | Value |
|---|---|---|
| Variable | `API_URL` | `https://api.example.com` |
| Secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | from step 3.5 |
| Secret | `DATABASE_URL_MIGRATE` | production connection string (for migrations) |
| Secret | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBKEY` | step 5 |
| Secret | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | step 4 |
| Secret (optional) | `SENTRY_DSN_WEB`, `SENTRY_DSN_DESKTOP` | Sentry projects; leave unset for no error reporting |

## 7. Ship it
- **API + web**: push to `main`. The *Deploy* workflow runs lint/typecheck/tests, applies database migrations, then
  deploys the Worker and the web app.
- **Mac app**: `git tag v0.2.0 && git push --tags`. The *Release desktop* workflow builds a universal (Intel + Apple
  Silicon) app, signs and notarizes it, and creates a **draft** GitHub release with the `.dmg`. Check it, then
  click **Publish**. Installed copies see the update within hours and offer "Update & restart".

## Rotating the token-encryption key
1. Set `TOKEN_ENC_KEY_PREVIOUS` to the current key, and `TOKEN_ENC_KEY` to a new `openssl rand -base64 32`.
2. Redeploy (secrets take effect on the next deploy). Within a few minutes the cron re-encrypts every connected
   calendar's token (a few per minute). Nobody has to reconnect.
3. Once the Worker log stops showing rotations, delete `TOKEN_ENC_KEY_PREVIOUS`.

## Known limits
- The desktop reminder scheduler and notifications run only while the app is running (it starts at login and lives in the tray).
- Google webhooks (instant calendar updates) need the public API URL; until then calendars refresh every 5 minutes.
- Intel and Apple Silicon are both covered by the universal build; Windows/Linux are out of scope.
