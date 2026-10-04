# Contributing to CourseCue

CourseCue is still evolving. For a substantial feature or structural change, open an issue describing the student problem, expected behaviour, and scope before implementation. Small fixes can go directly into a focused pull request.

## Development

Follow the [getting started guide](docs/GETTING_STARTED.md). Use `npm ci` to install the locked dependencies and `npm run dev` to start the app.

## Conventions

- Use the Next.js App Router and strict TypeScript. Keep route files in `src/app/` and feature components in the corresponding `src/components/` folder.
- Import environment variables through `src/lib/env.ts`. Keep secrets out of client components and `NEXT_PUBLIC_*` variables.
- Use the Supabase server client for Server Components and API routes, and the browser client for Client Components. Preserve row-level security.
- Validate API input before database or external calls and follow the existing Upstash rate-limit pattern.
- Keep scheduled work in `src/trigger/`. AI requests belong in `src/lib/nim.ts`; charts use D3, and shared client state uses Zustand.
- Use semantic theme tokens from `src/app/globals.css`. Compose `src/components/ui/` with `className` overrides; keep those primitives unchanged. See [UI patterns](docs/UI_PATTERNS.md).
- Keep tests near the code or in the existing `__tests__` folders. Add regression coverage when changing behaviour.
- Update public documentation when setup, behaviour, or deployment requirements change.

## Before a pull request

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

The production build requires valid environment configuration. Check the diff for credentials, generated service workers, logs, and personal data.

Explain the problem, resulting behaviour, and what you verified. Mention database changes or a required Trigger.dev deployment explicitly. Keep formatting-only changes separate from behaviour changes.
