# Build Progress

## Production Readiness — Completed

All critical and required fixes from the production-readiness audit have been implemented:

### Code Fixes (Session 16–17)
- C1: Canvas token AES-256-GCM encryption at rest (`src/lib/crypto.ts`)
- C2: Zod input validation on all API routes (`src/lib/validations.ts`)
- R1: Removed duplicate `/api/auth/callback` route
- R2: Fixed nudge/test gate (404 in prod instead of dev-only check)
- R3: Onboarding auth guard + removed from PUBLIC_PATHS
- R4: Removed unused `userId`/`timezone` props from ProductiveWindowTracker + AssignmentsClient
- R5: AutoSync 5-min cooldown on visibility change
- R6: Removed dead `userId` from SyncNowButton request body
- R7: Documented `numeric(4,3)` precision in schema

### Infrastructure Fixes (Session 17)
- P1: RLS audit — added missing `push_subscriptions` update policy + `nudge_logs` insert/update/delete
- P2: Token re-encryption migration ran on Supabase (all plaintext tokens now encrypted)
- P3: Strong `ENCRYPTION_KEY` (32-byte base64 random) in `.env.local`
- P4: Nudge-engine service role verified correct (bypasses RLS for cross-user queries)
- P5: Vitest + 19 smoke tests for crypto + validation modules
- P6: `.gitignore` verified — `.env.local` never committed to git history
- P7: Error boundaries (`error.tsx`) at root + dashboard layout; loading state at dashboard
- P8: SQL migration for RLS policies executed on Supabase

### Session 18 — PWA, Assignments Window, Nudge Engine Extensions
- **PWA Install Detection** — Fixed iPadOS 13+ detection (Mac UA + touch) in `MobileBrowserGate`, `MobileInstallGuide`, `/install` page; standalone PWA mode shows "already installed" state
- **Assignments 2-Week Window** — Server-side filter (past 14d + next 14d) on `/dashboard/assignments` and dashboard heatmap/stats; null-due-date assignments preserved
- **Auto-Cleanup Completed** — Nudge engine Section C deletes `is_completed=true` assignments older than 5 days; `nudge_logs` cascade via FK
- **Overdue Reminder Nudges** — New `overdue` nudge type (once per 24h per assignment); fires even in minimal mode; quiet hours + pause respected
- **Tests** — 11 new unit tests for window predicates, cleanup cutoff, overdue selection (31 total pass)
- **Manual E2E Verified** — Push subscribe, test notification, dev test routes (productive_window/overdue/12h), mobile install redirect, standalone bypass, 2-week window filter

### Pre-Launch Checklist

Before deploying to production, verify each item:

- [ ] **Environment variables** — All 14 vars in `.env.local` are set on the hosting platform (Vercel, etc.)
  - `ENCRYPTION_KEY`: Must be a **new** 32+ char cryptographically random key for production (not the dev key)
  - `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: Generate fresh VAPID keys for the production domain
  - `NUDGE_ENABLED`: Set to `"true"` when ready for push notifications
  - All other vars: Copy from `.env.local` or generate new production values
- [ ] **Supabase RLS** — Run `supabase/migrations/20260627_rls_policies.sql` on the production database
- [ ] **Token migration** — Run `npx tsx supabase/migrate-encrypt-tokens.ts` after setting the production `ENCRYPTION_KEY`
- [ ] **Trigger.dev** — Deploy the nudge-engine job: `npx trigger.dev@latest deploy`
- [x] **Build passes** — `npm run build` completes with no errors ✓
- [x] **Tests pass** — `npm test` (31/31) completes with all tests passing ✓
- [x] **Lint passes** — `npm run lint` completes with no errors ✓
- [ ] **Auth redirect URLs** — Add production domain to Supabase Auth → URL Configuration → Redirect URLs
- [ ] **PWA manifest** — Update `start_url` and icons in `public/manifest.json` for production domain
- [ ] **VAPID keys** — If using a new domain, regenerate: `npx web-push generate-vapid-keys`
- [x] **Migration: overdue nudge type** — Applied to prod 2026-08-23 (`20260816_overdue_nudge_type.sql`). **This was missing and caused overdue pushes to resend every cron run** (send succeeded, log insert rejected by old CHECK constraint, error swallowed by Promise.allSettled).
- [x] **Migration: nudge_logs dedup index** — Applied to prod 2026-08-23 (`20260823_nudge_logs_dedup_nonpartial.sql`). Replaced partial unique index: PostgREST upserts cannot infer partial indexes as ON CONFLICT arbiters (error 42P10).
- [ ] **Trigger.dev redeploy** — Cron changed from hourly (`0 * * * *`) to every 15 min (`*/15 * * * *`); run `npx trigger.dev@latest deploy` for prod to pick it up.
- [ ] **Migration: token_expired nudge type** — Run `supabase/migrations/20260827_token_expired_nudge_type.sql` on prod. Until applied, the canvas-sync task silently skips token-expired pushes (claim insert fails → no send; no spam either way).
- [ ] **Trigger.dev deploy (canvas-sync)** — New scheduled task `canvas-sync` (cron `5,35 * * * *`) must be deployed (`npx trigger.dev@latest deploy`) or server-side sync won't run in prod.

### Session 20 — Server-side Canvas sync (nudges without opening the app)

- **Problem**: assignments entered the DB only via `/api/canvas/sync`, which requires a logged-in browser session (`AutoSync.tsx` runs only in an open tab). If a user didn't open the app for days, due-date changes/new assignments never reached the DB, so the nudge engine had nothing to nudge about — deadline notifications silently never fired.
- **Shared sync core** (`src/lib/canvas-sync.ts`): `syncUserCanvas(serviceClient, userId)` — profile read + token decrypt + Canvas fetch + course/assignment upserts, moved verbatim out of the sync route. Returns a typed result (`ok` / `token_expired` / `decrypt_failed` / `not_connected` / `canvas_error` / `db_error`).
- **Sync route slimmed** (`/api/canvas/sync`): auth + rate limit + delegate + map result to the exact same HTTP shapes (AutoSync/SyncNowButton/OnboardingWizard unaffected).
- **New scheduled task** (`src/trigger/canvas-sync.ts`): `canvas-sync`, cron `5,35 * * * *` (offset from the nudge engine's `*/15`). Syncs every profile with stored Canvas credentials via service role, in chunks of 5. Dropped the route's no-op `profiles.updated_at` touch.
- **Token-expired push**: on Canvas 401 or decrypt failure the task sends one "Canvas Disconnected ⚠️" push per user per 72h (claim-before-send via `nudge_logs`, same pattern as the nudge engine; stale-sub cleanup on 410/404). Without it, a dead token silently killed ALL nudges until the user happened to open the app. Requires `20260827_token_expired_nudge_type.sql` on prod; claim failure degrades to "no push" (never spam).
- **Client behavior unchanged**: open-tab auto-sync still gives active users fresher data; server sync is additive and idempotent (same upsert conflict keys).
- **Fix after first deploy**: the task crashed on the Trigger.dev runtime (Node 21, no native WebSocket) because `createServerClient` eagerly initializes its realtime client — added `realtime: { transport: ws }` (same as nudge-engine). Required even though the task never subscribes to channels.

### Session 19 — Notification timing & overdue dedup hardening

- **Cron frequency**: `0 * * * *` → `*/15 * * * *`; deadline nudges now land within ~15 min of intent (previously up to 60 min late).
- **Catch-up buckets** (`src/lib/deadline.ts`): 1h (≤90m) / 6h (≤7h) / 12h (≤13h); an assignment gets exactly the bucket containing its remaining time — late-synced assignments get a nudge instead of being skipped; no stale larger bucket fires after a smaller one.
- **Accurate wording**: notification title/body computed from actual remaining time ("Due in ~5 Hours ⚡", "…due in 45 minutes (by 6:30 PM)") — no more static "~6 hours" for a 5h-away deadline.
- **Per-user send decision**: Sections B and D now decide once per user (previously per subscription), then fan out to the user's devices — removes the multi-device dedup race, halves DB queries.
- **Claim-before-send**: nudge_logs claim written before the push; if every device send fails, the claim is released so the next run retries. Repeats are now impossible without a durable record.
- **Overdue wording** (`src/lib/nim.ts`): past-due assignments no longer say "due today" — "was due yesterday / N days ago / earlier today", with an overdue-specific prompt rule.
- **Timezone fallback**: server-side `getDefaultTimezone()` is now `America/Chicago` (was the machine's zone — UTC on Trigger.dev workers).
- **Prod DB fixes (applied)**: added `overdue` to `nudge_logs.nudge_type` CHECK; replaced partial `nudge_logs_dedup` index with non-partial.
- **Tests**: 18 new in `deadline.test.ts` (68 total pass).

### Session 19b — Security hardening (from audit)

- **Timezone poisoning fix (was HIGH)**: one malformed `profiles.timezone` (writable via RLS) could crash the entire nudge engine run loop for all users. Fixed in 3 layers: `coerceTimezone()` guards every engine read; `timezoneSchema` (Intl-validated) in `saveNotificationSettings`; DB CHECK `profiles_timezone_shape` (regex) — applied to prod 2026-08-23.
- **`/api/nudge/test` now fails CLOSED** (404 unless `NODE_ENV === "development"`; previously default-on when env unset).
- **Server actions hardened**: quiet hours validated 0–23, `nudge_frequency` allowlisted, pause hours clamped ≤720 (Infinity crash), generic error messages (no raw PostgREST errors to client).
- **Rate limits**: `/api/canvas/encrypt` got its missing limiter (10/h); all routes now use distinct Redis prefixes (previously shared one budget per user).
- **Prompt hygiene**: assignment/course names sanitized (control/bidi chars stripped, 120-char cap) before NIM prompts.
- **Headers + PWA**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on all routes; removed `/api/*` from service-worker runtime cache (authed responses no longer persist per-user data on shared devices).
- **Service worker**: push handler no longer crashes on non-JSON payloads.
- **Deps**: Next 16.2.6 → **16.3.2** (patches reachable Server-Actions DoS); `@trigger.dev/sdk/build` → 4.5.12; `ws` forced ≥ 8.21.3 via override (patches DoS/memory advisories). Remaining audit noise: `next-pwa` build-time `serialize-javascript` (replace next-pwa post-launch), OTel baggage DoS inside trigger.dev tree.
- **`CRON_SECRET`** marked optional (unused legacy); `ENCRYPTION_KEY` schema pinned to base64-of-32-bytes (derivation MUST stay byte-stable — see crypto.ts comment).
- **Deferred**: push subscription ownership check on endpoint reuse (shared-device edge); unsubscribe/DELETE route + "disable on this device" UI; full CSP header.

### Key Rotation

If `ENCRYPTION_KEY` needs to change:
1. Set the new key as `ENCRYPTION_KEY` in env
2. Set the old key as `ENCRYPTION_KEY_PREVIOUS` in env
3. Update `crypto.ts` to try decrypt with new key first, fall back to old key
4. Run the migration script to re-encrypt with new key
5. Remove `ENCRYPTION_KEY_PREVIOUS` once all tokens are migrated


### Session 20 - Dashboard/Assignments data-accuracy fixes

- **"Last sync" was not a sync time**: it read `profiles.updated_at`, which only moves on settings saves. New `profiles.last_synced_at` column (migration `20260911_profiles_last_synced_at.sql`, **needs manual run in Supabase SQL editor**) stamped by `syncUserCanvas` after every successful Canvas fetch; both pages read it.
- **Overdue silently clipped at 14d**: dashboard + assignments queries had a `due_at >= -14d` floor, so older overdue items were invisible everywhere. Dashboard now fetches all open assignments (no due bounds; sync window is already -30d/+60d). Assignments page: all incomplete + completed touched in the last 14d.
- **Heatmap showed 6 weeks with only 14d of data**: fixed by the unbounded query; Canvas's +60d horizon now actually reaches the grid.
- **"Due this week" stat vs upcoming filter mismatch**: new `this-week` filter in AssignmentsClient (now to now+7d), dashboard stat links to it. "Total assignments" relabeled "Open assignments".
- **Canvas-completed items vanished from Completed filter**: sync upserts never touched `assignments.updated_at`. `buildSyncPlan` (new pure, tested fn in `canvas-sync.ts`) now stamps `updated_at` when Canvas flips a row to completed; dismiss and sticky-completion semantics unchanged (6 new tests, 74 total pass; lint + build green).
- **Known leftovers**: `get_workload_heatmap` RPC in schema.sql is dead code (UTC-bucketed); delete in a future migration.
### Session 21 - Password reset: magic link -> 8-digit email code

- **Bug**: reset links landed on `/login?error=link-expired` on first click. Proven cause: single-use `{{ .ConfirmationURL }}` verify links get consumed by mail-scanner prefetch (reproduced: fetching the same link twice, 2nd returns `otp_expired`) and/or PKCE `code_verifier` loss when a mail app opens the link outside the requesting browser (`AuthPKCECodeVerifierMissingError`, auth-js 2.105.4 source). Both collapse into the same banner.
- **Fix**: OTP code flow (Supabase docs' recommended Option 1 for prefetch). Login "Forgot password" now calls `resetPasswordForEmail` (no redirectTo) and routes to `/reset-password?email=...`; that page takes email + code + new password -> `verifyOtp({ email, token, type: 'recovery' })` -> `updateUser` -> dashboard. Code field accepts 8 digits (Supabase hosted now emits 8-digit OTPs).
- **Verified E2E**: fresh throwaway user via Admin API, code minted via `generate_link.email_otp`, full browser flow in dev: verify -> password updated -> sign-in with new password; wrong-code path shows inline error. 63/63 tests, tsc/lint/build clean.
- **Manual step needed**: Supabase Dashboard -> Authentication -> Email Templates -> "Reset password" must show `{{ .Token }}` and MUST NOT contain `{{ .ConfirmationURL }}` (a clickable link in the email = prefetch can still burn the code). Signup confirmation template unchanged.
- **Leftover**: `/auth/callback` still handles signup-confirm links (unchanged, scanner-vulnerable but lower stakes).
- **Retry fix**: verifyOtp consumes the code, so a submit where the code passed but `updateUser` rejected a weak password left retries hitting "invalid or expired". The page now skips verifyOtp when a session for that email already exists and goes straight to updateUser (HTTP-level proof: weak pass 422, re-verify 403, same-session compliant pass 200, sign-in 200).

### Session 22 - Sign-out now stops push notifications on that device

- **Report**: user logged out of the phone PWA and kept receiving nudges.
- **Root cause**: `DashboardSidebar.handleSignOut` only called Supabase `signOut`. A Web Push subscription is browser-level, not tied to the auth session, and the `push_subscriptions` row survived, so the nudge engine kept sending. The `DELETE /api/push/subscribe` endpoint existed but was never called on logout.
- **Fix**: new `unsubscribePushDevice()` (`src/lib/push.ts`) called at the top of `handleSignOut`, before `signOut` (the DELETE needs a valid session): deletes the server row for this device's endpoint, unsubscribes the browser PushManager, clears `push-synced:*` session markers. All best-effort (never blocks sign-out; a missed row is reaped by the existing 404/410 cleanup on next send).
- **Checked, no change needed**: overdue once-a-day is already enforced (Section D nudge claim-before-send + `nudge_logs` unique index + 24h rolling dedup in `overdue-dedup.ts`, covered by `overdue-dedup.test.ts`). One nudge per overdue assignment per 24h.
- **Sibling noted, untouched**: `OnboardingWizard` sign-out leaves push alone — onboarding never enables push (button lives in the dashboard), so no orphaned subscription is possible there.
- 66/66 tests (3 new in `push-unsubscribe.test.ts`), lint/build green.

## Upcoming Sessions (v1.1 — post-launch)

- Session 17: Soft Launch Prep + Analytics

## October 1, 2026 — UX refinement delivered

Six separate commits pushed through 5767938: three-day overdue limit and bounded push TTL; actionable assignment notification links and completion/dismissal controls; preserved completion/dismissal state across Canvas sync; date-grouped planner with 7/14/30-day windows, URL filters, 20-row pagination and complete database paging; richer wine/parchment/brass palette with contrast regressions; corrected repository guide.

Verification: 185 tests, ESLint and webpack production build pass. Local isolated browser verified filters, counts, pagination, older-overdue disclosure, responsive layouts and zero console errors. Synthetic preview route removed before build; no sample data shipped. Authenticated production mutations and device notification delivery have not been exercised. Trigger.dev deployment is separate from Git push and must be confirmed before claiming the new reminder behavior is live.

Production follow-up: with explicit user approval, Trigger.dev deployment e7rmvuba completed successfully as production version 20261002.1. The new background code is deployed; real device notification delivery remains unverified.

## October 1 — screenshot-based Canvas theme correction
The user's two actual TXST Canvas dashboard references replace the prior parchment/brass palette. Shared theme uses white workspace, exact #4B1610 rail, ivory nav labels, dark headings, neutral inputs/dividers, blue coursework/chart accents, and white active navigation. Dashboard banners are replaced by white headings; assignment rows use blue icon/deadline tiles. Public, auth and install screens match. ui-registry.md records the current baseline. No temporary synthetic preview is shipped.
