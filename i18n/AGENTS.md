# i18n

Locale files for the web app (`apps/web`), the landing package (`packages/landing`) and the public site (`apps/site`). `en-US.json` is the source of truth; the 19 other `<locale>.json` files mirror its keys. Follow the root [AGENTS.md](../AGENTS.md); skill: `i18n`.

## Structure

- Top-level keys are i18next namespaces (`common`, `tasks`, `settings`, `landing`, ...). Web code calls `t("namespace:path.to.key")`; `common` is the default namespace. Every namespace in the JSON is loaded automatically, so a new one needs no registration.
- Interpolation is `{{name}}`. A count-bearing string uses plural suffixes (`_one`, `_other`, ...). Each locale supplies the plural categories its own language needs (Russian adds `_few` and `_many`, Chinese has no `_one`), and `i18n:check` enforces exactly that set per locale.
- `resources.ts` lists `supportedLocales` and the per-locale dynamic imports. Adding a locale also means adding it to `LANDING_COPY_LOADERS` in `apps/site/lib/landing-locales.ts` and `LANDING_LOCALES` in `packages/landing`.
- `schema.json` is generated from `en-US.json`. Regenerate it with `pnpm i18n:schema` after adding, moving or removing keys; never edit it by hand.

## Translations

- Every new or changed `en-US` string gets a real translation in all 19 other locales, in the same change. Never leave an English copy in a non-English file, not even as a placeholder.
- Keep placeholders, plural families, product names and keyboard keys intact. Match the tone and terminology already used in that locale file.
- Email copy lives here too, in the `emails` namespace. After changing it run `pnpm i18n:emails`, which regenerates `packages/email/src/templates/messages.generated.ts`; `pnpm i18n:check` fails until you do. See `packages/email/AGENTS.md`.

## Scripts (run from the repo root)

- `pnpm i18n:check`: every locale has exactly the `en-US` keys, with the right plural forms. CI runs it. Pass a locale (`node scripts/i18n/check.mjs de-DE`) to check one file.
- `pnpm i18n:check:fix` adds missing keys by copying the English value (or the locale's existing plural wording). Its output is a to-do list, not a result: translate every inserted value afterwards.
- `pnpm i18n:report`: keys used in `apps/web/src` but missing from `en-US`, keys it thinks are unused, dynamic `t()` calls, and values still identical to `en-US` per locale. Use the "Untranslated" section to find English copies you left behind (some identical values, such as brand names, are legitimate).
- `pnpm i18n:report:fix` deletes the keys `pnpm i18n:report` lists as unused, from every locale. The report scans `apps/web/src` (including keys built as `` `ns:prefix.${x}` `` and through a file's own string constants) and never counts the `emails`, `landing`, `pricing`, `press` and `invitations.email` copy, which the email package, `apps/site`, `packages/landing` and the API read as whole objects. Read the unused list before running `--fix`; a key reached some other way needs adding to `externallyReadPrefixes` in `scripts/i18n/report.mjs`.

## Verify

`pnpm i18n:check` must pass. Read the "Untranslated" section of `pnpm i18n:report` for the keys you touched. For web copy, also run the web tests that cover the component.
