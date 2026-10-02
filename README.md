# DuePulse

**Your Canvas assignments, organised around what comes next.**

DuePulse brings Canvas coursework into one student dashboard: approaching deadlines, a searchable assignment planner, workload charts, and study reminders with AI-generated wording.

Built with **Next.js · React · TypeScript · Supabase · D3 · Trigger.dev**. The web app runs on **Vercel**; scheduled jobs run separately on **Trigger.dev**.

## What it does

| Area | Current implementation |
| --- | --- |
| Canvas sync | Imports courses, assignments, and due dates, with manual refresh and a scheduled sync every 30 minutes. |
| Assignment planner | Date groups, search, course filters, 7/14/30-day windows, and pagination. Completion and dismissal states survive sync. |
| Workload | D3 heatmaps and charts show upcoming coursework and recorded activity. |
| Study reminders | Deadline, recent-overdue, and activity-window nudges, with quiet hours, frequency preferences, and pause controls. NVIDIA NIM generates wording, with fallback messages. |
| Mobile access | Installable PWA with Web Push on supported browsers and devices. |

**Status:** actively evolving. The product direction is still being explored; the features above describe the current code, not a finished roadmap.

Marking an assignment complete or dismissing it updates DuePulse only; it does not submit work to Canvas. Activity insights use dashboard activity scores and heuristics rather than measuring study time or predicting academic performance. Push delivery depends on device support, permission, and configured background jobs.

## Run locally

Use Node.js 24 and npm. You need your own Supabase project, Upstash Redis, NVIDIA NIM credentials, Web Push keys, Trigger.dev project, and a Canvas account that allows personal access tokens. There is no bundled demo account or offline demo mode.

```sh
git clone https://github.com/sthakri/duepulse.git
cd duepulse
npm ci
```

Create `.env.local` at the repository root with the following values. Validation in [src/lib/env.ts](src/lib/env.ts) requires integration credentials even when scheduled reminders are disabled.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key, used with row-level security |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public key from your VAPID pair |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role key |
| `CANVAS_DOMAIN` | Canvas hostname, such as `your-school.instructure.com` |
| `NIM_API_KEY` | NVIDIA NIM API key |
| `VAPID_PRIVATE_KEY` | Private key from the same VAPID pair |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `TRIGGER_SECRET_KEY` | Trigger.dev environment secret key |
| `ENCRYPTION_KEY` | A 32-byte key encoded as padded base64 |
| `NUDGE_ENABLED` | `false` until you intend to send scheduled reminders |

Optional AI overrides are `NIM_BASE_URL` (default `https://integrate.api.nvidia.com/v1`) and `NIM_MODEL` (default `mistralai/mistral-nemotron`). `CANVAS_PERSONAL_TOKEN` and `CRON_SECRET` are optional legacy variables; users enter their Canvas token during onboarding. `NEXT_PUBLIC_APP_ENV` is derived from `NODE_ENV` in the environment module.

Generate the Web Push key pair and encryption key:

```sh
npx web-push generate-vapid-keys
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep credentials out of Git. Reuse the encryption key wherever the same database's Canvas tokens are read; changing it makes existing tokens unreadable. Preserve the VAPID pair for existing push subscriptions. Only browser-safe values belong in `NEXT_PUBLIC_*` variables.

For a **new, empty** Supabase project, run [supabase/schema.sql](supabase/schema.sql) in the SQL Editor. It includes current tables, indexes, and row-level security policies. The files in [supabase/migrations/](supabase/migrations/) are historical, manually applied upgrades; many are already included in the schema. For an existing database, apply only missing changes instead of replaying every file or blindly rerunning the schema.

Configure Supabase Auth URLs for your local app and deployed origin, including `/auth/callback`. Signup uses email confirmation. Password recovery uses a code-entry flow: the Reset password email template must display `{{ .Token }}` rather than a clickable `{{ .ConfirmationURL }}`.

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000), create an account, and complete onboarding with your Canvas domain, personal token, and timezone.

## Repository layout

```text
src/
├── app/                     # App Router pages, layouts, server actions, API routes
├── components/
│   ├── assignments/         # Planner, assignment rows, workload alerts
│   ├── auth/                # Authentication branding and onboarding
│   ├── canvas/              # Sync controls and connection state
│   ├── dashboard/           # Dashboard navigation
│   ├── insights/            # D3 charts, activity tracking, insight cards
│   ├── push/                # Notification permission and test controls
│   ├── pwa/                 # Mobile browser and installation guidance
│   ├── settings/            # Notification preferences
│   └── ui/                  # Shared shadcn/ui primitives
├── lib/                     # Domain rules, integrations, state, validated env
│   ├── __tests__/           # Unit and regression tests
│   └── supabase/            # Server and browser clients
├── trigger/                 # Scheduled Canvas sync and nudge engine
├── database.types.ts        # Supabase database types
└── proxy.ts                 # Session refresh and route access
supabase/                    # Database schema and historical migrations
public/                      # Icons and PWA manifest
worker/                      # Custom Web Push service worker handlers
```

Framework, test, and deployment configuration stays at the repository root. Canvas sync writes to Supabase; the web app reads that data for the planner and D3 dashboard. Trigger.dev processes deadlines and activity windows, generates reminder wording through NVIDIA NIM, and sends notifications through Web Push. Client state uses Zustand; API rate limiting uses Upstash Redis.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Next.js server with webpack |
| `npm run build` | Production build with webpack and generated PWA assets |
| `npm start` | Serve an existing production build |
| `npm run lint` | ESLint checks |
| `npm test` | Vitest unit and regression suite |
| `npm run test:watch` | Run tests during development |
| `npx tsc --noEmit` | Type checking |

The webpack flags are intentional: the current `next-pwa` integration uses webpack. Dependency versions are recorded in [package.json](package.json) and pinned by [package-lock.json](package-lock.json).

## Hosting and background jobs

Vercel builds the web app using `npm run build`. Keep the repository root, Next.js output defaults, and function paths in [vercel.json](vercel.json). Configure environment variables for the relevant Vercel environment before building; changing `NEXT_PUBLIC_*` values requires a rebuild. Service workers are generated during the build. PWA generation is disabled in development; test installation and notifications with a production build and a supported browser. Remote device testing needs HTTPS.

Canvas sync and reminder schedules run on Trigger.dev separately. A Git push to Vercel does not update these jobs or apply database migrations. For your own instance, set your project ID in [trigger.config.ts](trigger.config.ts) and configure the job environment with the required Supabase, encryption, AI, Redis, Trigger.dev, and VAPID values. Loading `.env.local` in Next.js does not configure hosted jobs.

Use the CLI version matching the installed SDK:

```sh
npx trigger.dev@4.6.3 dev
# After verification, deploy production tasks separately:
npx trigger.dev@4.6.3 deploy
```

Canvas sync is scheduled every 30 minutes (`5,35 * * * *`, UTC); the nudge engine checks every 15 minutes (`*/15 * * * *`, UTC). Set `NUDGE_ENABLED=true` only when reminders should be sent. Overdue reminders are eligible during the first 72 hours after a deadline, at most once per assignment per 24 hours. Older overdue work remains accessible in the planner.

Before publishing a change, run tests, lint, type checking, and a production build with valid configuration. Tests use mocked integrations; a successful build does not prove live credentials, database migration state, scheduled runs, or device delivery. Verify those separately when changing the affected integration.
