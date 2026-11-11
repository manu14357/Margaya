---
name: i18n
description: Add, change, rename or remove user-facing text in Margaya - static i18n keys in i18n/en-US.json, real translations in all 19 other locales, the i18n:check / i18n:report / i18n:schema scripts, plus localised email and API copy. Use when adding a translation key, writing UI copy, changing a label or message, fixing "missing key" CI failures, or touching email templates.
---

# i18n

Purpose: every user-facing string is a static key, `i18n/en-US.json` is the source of truth, and every other locale gets a real translation. Root rules: [AGENTS.md](../../../AGENTS.md).

## The hard rule

`i18n/` holds `en-US.json` plus 19 other locales: az-AZ, de-DE, el-GR, es-ES, fr-FR, hi-IN, id-ID, it-IT, ja-JP, ko-KR, mk-MK, nl-NL, pl-PL, pt-BR, ru-RU, tr-TR, uk-UA, vi-VN, zh-CN. **Each one gets a real translation in its own language. Never paste the English text into them**, not even as a placeholder. (CONTRIBUTING.md says an English placeholder is fine; in this repo it is not.) Keep `{{placeholders}}` byte-identical, keep named tags such as `<email>...</email>` (used with `<Trans>`), and translate product terms consistently with the rest of that file (grep the locale for the term first). Brand names, code and units may stay as they are.

## Steps

1. **Pick the namespace and key.** Top-level keys of `en-US.json` are namespaces (`common`, `settings`, `tasks`, `cycles`, `pages`, `ai`, ...). Use dot paths inside a namespace and group by feature, e.g. `settings.trash.retry`. Reuse `common:actions.*` for generic verbs (Cancel, Delete, Close) instead of adding duplicates.

2. **Add the English text** to `i18n/en-US.json`. The files are tab-indented JSON; keep that formatting.
   - Interpolation: `"greeting": "Hi {{name}}"`, used as `t("ns:greeting", { name })`. Never concatenate translated fragments.
   - Plurals (i18next): `key_one` and `key_other` with `{{count}}`. Other locales add the categories their language needs (`_few`, `_many` in ru/uk/pl, only `_other` in ja/zh/ko); `scripts/i18n/check.mjs` derives the required set from `Intl.PluralRules`.

3. **Use it with a static key.**
   ```tsx
   const { t } = useTranslation();
   <Button>{t("settings:trash.retry")}</Button>
   ```
   Example: `apps/web/src/components/trash/trash-list.tsx`. Calls like `t(variable)` or ``t(`tasks:${x}`)`` cannot be checked and are listed under "Dynamic keys" by the report. To pick a key at runtime, map to full literal keys (`{ open: "tasks:status.open" }`): the report also picks up quoted `"namespace:dotted.path"` strings.

4. **Translate into all 19 locales.** Add the same key path to every `i18n/<locale>.json` with a real translation. Real example, `settings.trash.taskCount` (used for "N tasks"):
   ```jsonc
   // en-US.json
   "taskCount_one": "{{count}} task", "taskCount_other": "{{count}} tasks"
   // de-DE.json
   "taskCount_one": "{{count}} Aufgabe", "taskCount_other": "{{count}} Aufgaben"
   // ru-RU.json: one, few, many, other
   "taskCount_one": "{{count}} задача", "taskCount_few": "{{count}} задачи",
   "taskCount_many": "{{count}} задач", "taskCount_other": "Задач: {{count}}"
   // ja-JP.json: other only
   "taskCount_other": "{{count}} 件のタスク"
   ```
   Locale files have no fixed key order requirement, but insert new keys next to their siblings so diffs stay readable. `pnpm i18n:check:fix` inserts missing keys but fills them with **English** text. If you use it to create the structure, you must then replace every inserted value; the report in step 5 lists what is still identical to en-US.

5. **Run the checks** (all read-only except the `:fix` variants):
   - `pnpm i18n:check` (`scripts/i18n/check.mjs`): compares every locale with en-US and lists missing and extra keys, with plural rules per locale. Exits 1 on any issue; CI runs it (`.github/workflows/ci.yml`, job `i18n`). Filter one locale: `pnpm i18n:check de-DE`.
   - `pnpm i18n:check:fix`: same, then writes missing keys (English values) into the locale files. Translate them afterwards.
   - `pnpm i18n:report` (`scripts/i18n/report.mjs`): scans only `apps/web/src/**/*.ts(x)` and prints missing keys, unused keys, dynamic `t()` calls, and per locale the values still identical to en-US. It already reports a long backlog; read it for **your** keys only, e.g. `pnpm i18n:report | grep "settings:trash"`. None of your new keys may appear under "Untranslated".
   - `pnpm i18n:schema` (`scripts/i18n/schema.mjs`): regenerates `i18n/schema.json` from en-US (then formats it with Biome). Run it when you add, rename or remove keys. CONTRIBUTING.md lists it as a step before a PR; CI does not check it.

6. **Renaming or removing keys.** Change en-US and all 19 locales together, then run `pnpm i18n:check`. To drop dead keys, run `pnpm i18n:report`, check each listed unused key with a grep of the whole repo, then `pnpm i18n:report:fix`. The report already skips the `emails`, `landing`, `press`, `download`, `desktop.launcher` and `invitations.email` copy that the email package, `apps/site`, `packages/landing`, the desktop launcher and the API read as whole objects; if it lists a key that is used some other way, add its prefix to `externallyReadPrefixes` in `scripts/i18n/report.mjs` instead of deleting it.

## Text outside the web app

- **Transactional emails and their subjects**: the `emails` namespace of every locale file (`emails.otp`, `emails.authSubjects`, `emails.trialReminder`, …). Edit the JSON in all 20 locales, run `pnpm i18n:emails` to regenerate `packages/email/src/templates/messages.generated.ts`, then `pnpm i18n:check`. Templates and API code read it with `emailCopy(locale)`, `fill()` and `plural()` from `@margaya/email`. A new email language needs a new entry in `emailLocales` (`packages/email/src/templates/resolve-locale.ts`) and its locale file.
- **Desktop launcher copy** lives under `desktop.launcher.*` in the same locale files and follows the same rules: English in `en-US.json`, real translations in all 19 others. The launcher (through `apps/desktop/scripts/desktop-i18n.ts`) and the desktop's Rust core read them at build time, so `desktop:launcher.` is in `externallyReadPrefixes` in `scripts/i18n/report.mjs` and the report never counts them as unused.
- **Invitation email copy** comes from the `invitations.email` keys, loaded by `apps/api/src/utils/get-workspace-invitation-email-copy.ts` for all 20 languages.
- **API error messages** from `HTTPException` are plain English. The web app shows its own keys for failure classes (`common:error.messages.*` in `apps/web/src/lib/error-handler.ts`) or a feature-specific key chosen by status, as `components/trash/task-trash-view.tsx` does for a 409 (`error instanceof HttpError && error.status === 409`).

## Translation workflow tips

- Work locale by locale, reading the surrounding keys in that file so tone and terms match (e.g. how that locale already says "task", "cycle", "workspace").
- Before finishing, list your new keys in each locale and compare against en-US: `pnpm i18n:check <locale>` catches structure, the report's "Untranslated" section catches English left behind.
- Tests mock `react-i18next` and assert on keys (see `apps/web/src/components/trash/trash-views.test.tsx`); e2e specs assert on the en-US text, so changing English copy can break `tests/e2e` locators. Grep `tests/e2e` for the old text.

## Done when

- [ ] No hard-coded user-facing string in changed web files; every `t()` call uses a literal key.
- [ ] `pnpm i18n:check` prints "All locale files are in sync with en-US."
- [ ] `pnpm i18n:report | grep "<your key prefix>"` shows none of your keys as missing, dynamic or untranslated.
- [ ] `pnpm i18n:schema` run if keys were added, renamed or removed.
- [ ] Email copy changes are in the `emails` namespace of all 20 locales, `pnpm i18n:emails` was run, and `pnpm --filter @margaya/email test` passes.
- [ ] Spot-check: placeholders identical across locales, plural categories present, no English left in non-English files.
