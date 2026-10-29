# packages/email

Transactional email for the API: React Email templates in `src/templates/`, `send*Email` functions in `src/send-email.tsx`, and the SMTP settings and transport (`src/smtp-config.ts`, `src/smtp-transport.ts`). The public surface is `src/index.tsx`. Only `@margaya/api` uses it. Follow the root [AGENTS.md](../../AGENTS.md).

## How it is wired

- Consumers import the compiled `dist/`. Run `pnpm --filter @margaya/email build` (or any turbo task, which builds dependencies first) before the API sees a change.
- SMTP settings come from the environment by default. The API swaps in instance settings with `setSmtpConfigProvider` (`apps/api/src/instance-settings/snapshot.ts`), so read settings through `isSmtpConfigured` / the provider, never straight from `process.env`.
- The API decides the recipient and the subject line. Subjects come from the same email copy as the bodies (`emailCopy(locale).authSubjects`, `.trialSubjects`, …), imported from `@margaya/email`.
- The API integration tests alias `@margaya/email` to `tests/api-integration/mocks/email.ts`. A new export that the API calls needs a matching stub there, or it is missing in those tests.

## Templates and locales

- Email copy lives in the `emails` namespace of `i18n/<locale>.json`, in all 20 languages, never as an English copy. This package compiles with tsc and ships without `i18n/`, so `pnpm i18n:emails` generates `src/templates/messages.generated.ts` from the JSON; never edit that file, and `pnpm i18n:check` fails when it is stale.
- Read copy with `emailCopy(locale)` from `src/templates/copy.ts`, which resolves any locale form ("de-DE", "pt", null) through `resolveEmailLocale` and falls back to English. Fill `{{placeholders}}` with `fill()` and pick count-dependent wording with `plural()` (i18next `_one`/`_few`/`_many`/`_other` keys, chosen by `Intl.PluralRules`). Call `plural()` before filling user text, so a name containing `{{count}}` stays as typed.
- `workspace-invitation.tsx` takes its copy as a prop: the API builds it from the `invitations.email` keys (`apps/api/src/utils/get-workspace-invitation-email-copy.ts`).
- Wrap templates in `EmailShell` from `src/templates/shell.tsx` and reuse its `styles`. Give every template `PreviewProps` so the preview server can render it.
- Batched and digest emails send a plain-text part as well (`sendHtmlAndText`); keep them readable as text.
- Pass data in as props and let React escape it. Never build HTML strings from user input.

## Failure behavior

Send functions differ: the auth emails (magic link, OTP, password reset, email changed) and the trial reminder log and swallow SMTP errors, while the workspace invitation, notification, batch and digest sends throw on SMTP errors and return `{ success: false, reason: "SMTP_NOT_CONFIGURED" }` when SMTP is off, so callers can retry or record delivery. Keep a new function consistent with the closest existing one.

## Verify

- `pnpm --filter @margaya/email test` and `pnpm --filter @margaya/email build`.
- Preview locally with `pnpm --filter @margaya/email dev` (React Email on port 3002).
- Delivery end to end: the notification specs in `tests/e2e` read mail from MailPit (see `tests/AGENTS.md`).
