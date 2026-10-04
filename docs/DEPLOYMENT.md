# Deployment

The web app runs on Vercel. Canvas sync and reminder jobs run on Trigger.dev. Database changes are applied separately in Supabase.

## Vercel web app

Preserve the existing connected project and production branch. This is a single Next.js app; its root contains `package.json`, `next.config.ts`, and `vercel.json`.

| Setting | Repository expectation |
| --- | --- |
| Framework | Next.js |
| Root directory | The directory containing this repository's `package.json` |
| Install command | `npm ci` for a reproducible install |
| Build command | `npm run build` (`next build --webpack`) |
| Output directory | Next.js default; no custom output override |

The current `next-pwa` integration requires webpack. Keep the build script, `public/`, `worker/`, and [`next.config.ts`](../next.config.ts) together. Service workers are generated during the build and do not need to be checked into Git.

[`vercel.json`](../vercel.json) sets 60-second limits for selected API functions using their source paths. Moving components does not change those paths. Moving API handlers would require reviewing these entries.

Configure required variables from the [README environment table](../README.md#run-locally) in the relevant Vercel environments. `NEXT_PUBLIC_*` values are embedded at build time, so rebuild after changing them. Preserve the encryption key and VAPID pair for an existing database and its subscriptions. Configure the corresponding Supabase Auth origin and callback URL.

These are repository expectations, not a readout of the connected project's dashboard settings. Check those settings before changing a deployment override.

## Trigger.dev jobs

[`trigger.config.ts`](../trigger.config.ts) identifies the project and task directories. For a fork, use your own project ID. A Vercel deployment does not deploy these tasks.

Configure the job environment with required variables from `src/lib/env.ts`, including Supabase credentials, encryption key, NIM credentials, and both VAPID values. Set `NUDGE_ENABLED=true` only when reminders should be sent.

After verification, deploy with the CLI version matching the installed SDK:

```sh
npx trigger.dev@4.6.3 deploy
```

Confirm task versions and schedules in Trigger.dev:

| Task | Schedule in source |
| --- | --- |
| `canvas-sync` | `5,35 * * * *` — every 30 minutes, UTC |
| `send-nudges` | `*/15 * * * *` — every 15 minutes, UTC |

## Database changes

Use the current schema for a fresh database and historical migrations only for missing upgrades to an existing database. See [getting started](GETTING_STARTED.md). Code deployment does not apply SQL, and the repository does not establish which migrations have been applied to a live project.

## Verify a release

1. Run tests, lint, TypeScript checks, and a production build with valid configuration.
2. Check the Vercel deployment result and inspect public pages, login, onboarding, and authenticated dashboard routes.
3. Verify Canvas sync with an authorised account and confirm completion/dismissal state survives refresh.
4. For background changes, confirm the deployed Trigger.dev version and inspect scheduled runs.
5. For push changes, test permission, subscription, delivery, notification navigation, and sign-out cleanup on a supported device.

A local build verifies compilation; it does not prove production credentials, remote service access, or device delivery. Roll back the web deployment and background task version independently if needed. Database changes need their own recovery plan.

## Post-deploy smoke test

- [ ] Public pages, login, onboarding, and dashboard load; unauthenticated `/dashboard` redirects to `/login`.
- [ ] Sync Now works and rate-limits to 429 on rapid repeats; heatmap and productive-windows chart render.
- [ ] Push subscribe stores a `push_subscriptions` row; a test push arrives; sign-out removes the row.
- [ ] `canvas-sync` and `send-nudges` show deployed versions and schedules in Trigger.dev; `NUDGE_ENABLED=true` only when intended.
- [ ] PWA installs and runs standalone; no horizontal overflow at 375px; `sw.js` registered.
