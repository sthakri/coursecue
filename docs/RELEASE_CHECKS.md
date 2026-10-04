# Release verification

CourseCue has three independently deployed parts: the Vercel web app, Trigger.dev tasks, and Supabase schema. A successful Git push verifies none of them by itself.

## Automated checks

```sh
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

The regression suite covers Canvas pagination and trust boundaries, assignment/quiz/discussion identities, undated coursework, concurrent completion changes, timezone rules, push subscription ownership and cleanup, worker navigation, and notification preference/history/claim failures. Integrations are mocked in these tests.

## Release pass, 2026-10-03

| Check | Result |
| --- | --- |
| Clean dependency install | Passed with `npm ci --ignore-scripts`; the subsequent production build also passed. |
| Regression suite | 285 tests across 31 files passed. |
| ESLint and TypeScript | Passed. Generated Trigger.dev bundles are excluded from lint. |
| Production webpack/PWA build | Passed. |
| Live Canvas sync | Passed with an authorised account; imported previously missing undated coursework. |
| Completion round trip | Completed a quiz, synced successfully, confirmed completion survived, then restored its original status. |
| Planner controls | Search, course filters, 7/14/30-day windows, pagination, completed/overdue/undated views and empty states passed. |
| Settings | Save/reload, invalid quiet-hour rejection, pause/resume passed; original settings restored. |
| Desktop Web Push | Enable, normal test, silent test and disable passed. The account owner confirmed both tests appeared in system notifications; audible behavior was not independently verified. |
| Responsive UI | Desktop at 1440px and narrow layout at 375px checked, including D3 charts, navigation, install guidance and feedback. No page-level horizontal overflow in checked views. |
| Trigger.dev bundle | Production dry run passed. Hosted task deployment and scheduled execution are separate checks. |

The account had no overdue work for a live dismissal test. Dismissal validation and state retention have regression coverage. Creating accounts, changing credentials, and submitting real coursework were not part of the browser pass. Physical iPhone/Android acceptance remains required below.

## Browser and service checks

- Sign in, visit each dashboard page, and confirm signed-out routes redirect correctly.
- Sync an authorised Canvas account. Check an assignment, quiz, exam, discussion, and undated item when the account contains them. Course-level access restrictions must not discard accessible planner work.
- Search, change courses and date ranges, paginate, and test empty states. Complete an item, sync, verify it remains completed, then undo the test change.
- Save notification preferences and reload. Verify quiet-hour validation; pause and resume. Restore the account's original settings.
- Enable notifications on a supported device. Send a normal test and a silent test, tap a notification, disable the subscription, and check sign-out cleanup. A successful API response means the push service accepted the message; it does not prove the operating system displayed it.
- Check desktop and narrow layouts, keyboard navigation, dialog focus, charts, feedback, and installation guidance.
- Confirm deployed Trigger.dev versions and schedules. Check a successful Canvas sync and nudge run; avoid forcing unsolicited notifications to other users.

## Device acceptance

Desktop Chrome with a narrow viewport checks layout, but cannot verify iOS or Android installation, native permissions, sound, Focus/Do Not Disturb, or background delivery. Test those on physical devices before claiming complete device coverage. Silent notifications remain visible; they request no sound or vibration. Normal notifications follow device defaults and cannot force sound.

Installation instructions follow [Apple's Home Screen web app guide](https://support.apple.com/guide/iphone/iphea86e5236/ios) and [Google's Android web app guide](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en). The notification worker uses the browser's [notification options](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification). Browser menus and feature support can change.

## Dependency audit, 2026-10-03

The production dependency audit reports zero known vulnerabilities after compatible updates. Build-time tooling is classified under `devDependencies`; it is still installed for builds and must still be audited.

The full audit reports 13 high-severity entries propagated from `braces` and `deepmerge-ts` through lint, PWA, shadcn, and related build tooling. The registry provides no patched `braces` release at this review. These tools process trusted repository inputs in this project. Do not feed untrusted glob patterns or object graphs to build tools. Track upstream fixes and reassess before accepting external build inputs; `npm audit fix --force` proposes incompatible downgrades and is not a verified remedy.

The vulnerable serializer used by the PWA build is overridden with `serialize-javascript` 7.1.2 or later. Keep its production-build verification when updating that override.
