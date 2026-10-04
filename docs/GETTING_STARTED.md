# Getting started

Full setup lives in [README](../README.md) ("Run locally"). Quick version:

- Require Node 24 + npm, a Supabase project, Upstash Redis, NVIDIA NIM, Trigger.dev, and a Canvas personal access token. `src/lib/env.ts` validates every variable even when reminders are disabled; there is no offline demo mode.
- `git clone https://github.com/sthakri/coursecue.git && cd coursecue && npm ci`
- Create `.env.local` using the variable table in the README.
- Generate keys: `npx web-push generate-vapid-keys`; `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` → `ENCRYPTION_KEY`. Reuse the same encryption key/VAPID pair everywhere that database is read.
- Fresh database: run [schema.sql](../supabase/schema.sql) in the SQL editor (not idempotent). `supabase/migrations/` are historical manual upgrades — apply only missing changes.
- Supabase Auth: configure local + deployed origins including `/auth/callback`; Reset password template must show `{{ .Token }}` (no `{{ .ConfirmationURL }}`).
- `npm run dev` → [localhost:3000](http://localhost:3000); onboarding needs Canvas domain, token, and timezone. PWA/service worker runs only in production builds; remote device testing needs HTTPS.
- Jobs: set your project ID in [trigger.config.ts](../trigger.config.ts), then `npx trigger.dev@4.6.3 dev`. Keep `NUDGE_ENABLED=false` until reminders are intended. See [deployment](DEPLOYMENT.md).
- Checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Tests mock integrations — live Canvas, migrations, scheduled runs, and device delivery are not covered.
