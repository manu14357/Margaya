---
name: docs-and-openapi
description: Update Margaya documentation - user guides in apps/docs (docs.json nav, frontmatter, MDX components, <Screenshot> and the docs-shots capture runner), API reference endpoint pages, and the committed apps/docs/openapi.json via pnpm openapi:check:fix. Use when a route, request or response schema changes, when CI's openapi job fails, or when writing or editing a docs page or screenshot.
---

# Docs and OpenAPI

Purpose: keep the public docs and the committed API reference in step with the product. Root rules: [AGENTS.md](../../../AGENTS.md). The route change itself is covered by the `api-endpoint` skill.

How it fits together:
- `apps/docs` holds the content: Mintlify-compatible MDX plus `docs.json` (navigation, redirects). It has no package.json.
- `apps/site` (Next.js, static export) renders it at `/docs`. `apps/site/lib/docs/source.ts` reads `../docs` from disk at build time (per request in `next dev`); `lib/docs/markdown.ts` renders the MDX; `lib/docs/openapi.ts` reads `apps/docs/openapi.json` for the API reference.
- The API's Ask AI also reads the guides under `apps/docs/core` (`apps/api/src/ai-ask/docs.ts`), so guide text is product behavior too.

## A. Route or schema changed: regenerate openapi.json

1. Make the API change with accurate `createRoute` metadata: unique `operationId`, `tags`, `summary`, `description`, request schemas in the feature's `schema.ts`, response schemas in `response.ts` named with `.openapi("Name")`. Example: `apps/api/src/trash/index.ts`.
2. Regenerate the committed artifact:
   ```sh
   pnpm openapi:check:fix
   ```
   `scripts/openapi/check.mjs` builds the API's workspace dependencies (`turbo build --filter=@margaya/api^...`), runs `apps/api/scripts/export-openapi.ts` (boots `createApp()` and fetches `/api/openapi` with a throwaway `AUTH_SECRET`), and compares the result with `apps/docs/openapi.json` (CRLF-insensitive). `--fix` copies the new file over; without it the script exits 1 on drift. It must be run through pnpm (it needs `npm_execpath`). No database is needed.
3. Read the diff of `apps/docs/openapi.json`. Only your operations and schemas should change. Unexpected removals mean a route lost its OpenAPI metadata.
4. Confirm: `pnpm openapi:check` prints `apps/docs/openapi.json is up to date`. CI runs the same command (job `openapi` in `.github/workflows/ci.yml`).

## B. New or renamed operation: the API reference page

1. Create `apps/docs/api-reference/endpoints/<tag-folder>/<operationId>.mdx`, copying `apps/docs/api-reference/endpoints/trash/emptyTaskTrash.mdx`:
   ```mdx
   ---
   title: emptyTaskTrash
   description: 'Empty a project''s trash'
   openapi: 'POST /trash/project/{projectId}/empty'
   ---
   ```
   The `openapi` path is the OpenAPI path **without** the `/api` prefix (the server URL in openapi.json already ends in `/api`), with `{param}` placeholders.
2. List the page in `apps/docs/docs.json` under the "API Reference" tab, in the group for its tag (for example the `"group": "Trash"` block). A renamed or removed operation means renaming or deleting its page and nav entry too.
3. The opt-in docs-site e2e spec checks that every listed endpoint page points at a real operation: `tests/e2e/specs/docs-site/api-reference.spec.ts`.

## C. User guides

1. Guides live in `apps/docs/core/**` (`functional/` for product features, `installation/`, `integrations/`, `deployments/`, ...). Copy the shape of `apps/docs/core/functional/trash-and-restore.mdx`. The desktop app has two guides, `apps/docs/core/functional/desktop-app.mdx` (users) and `apps/docs/core/installation/desktop-app.mdx` (admins, `DESKTOP_*` settings); update them when the `desktop-app` contract or its download files change. The Download page itself is `apps/site/app/download/page.tsx`.
2. Frontmatter: `title` (required; the build throws without it) and `description`. `mode: landing` is used only by `apps/docs/index.mdx`.
3. Add the page id (path without `.mdx`) to the right group in `apps/docs/docs.json`. Every id listed there must exist, or the site build throws. Unlisted pages still render but are missing from the sidebar. When moving a page, add an entry to `redirects` in docs.json.
4. Components the renderer supports (`apps/site/lib/docs/markdown.ts`): `Note`, `Info`, `Tip`, `Check`, `Warning`, `Danger`, `Steps`/`Step`, `Card`, `CardGroup`, `Columns`, `AccordionGroup`/`Accordion`, `Frame`, `Screenshot`, `Kbd`, `ButtonGroup`/`Button`, `CodeGroup`, `Tabs`/`Tab`. Anything else will not render as you expect.
5. Write for the reader ("you"), lead with the goal, bold UI labels exactly as the English UI shows them (`i18n/en-US.json`). Guidance: `apps/docs/CONTRIBUTING.md` "Writing guidelines".

## D. Screenshots

1. Reference one in MDX with `<Screenshot src="data/project-trash" alt="..." caption="..." />`. `src` is a name in `apps/site/public/images/docs/manifest.json`; an unknown name fails the site build (`requireDocsShot` in `apps/site/lib/docs/screenshots.ts`).
2. Shots are defined in `apps/site/scripts/docs-shots/specs/<section>.mjs` (`admin-integrations`, `ai`, `data-account`, `desktop`, `getting-around`, `planning`, `tasks`). Copy an existing entry, e.g. `name: "data/project-trash"` in `data-account.mjs`. The header of `capture.mjs` documents every field.
   The `desktop` section shoots Margaya Desktop without the installed app: its own windows (server list, quick add, offline page) come from the launcher bundle, so run `pnpm --filter @margaya/desktop build` first; the spec serves `apps/desktop/dist` at `http://tauri.localhost` with a stand-in `window.__TAURI_INTERNALS__` that answers with fictional servers. Server windows are the web app with a do-nothing `window.__MARGAYA_DESKTOP__` bridge injected before load. `desktop/download-page` reads the site at `DOCS_SHOTS_SITE_URL` (default http://localhost:3001); run its `next dev` with `DESKTOP_RELEASES_FILE` set to a saved Releases response with fictional files, and open it as `localhost`, not 127.0.0.1. See the header of `specs/desktop.mjs`.
3. Capture (LOCAL DEVELOPMENT ONLY): it needs the API on :1337 and web on :5173 (see `local-stack`), Microsoft Edge, and Playwright from `tests/e2e`. It seeds fictional demo data into that instance through `apps/site/scripts/press/seed-demo.mjs`, so point it only at a disposable local database, never a shared or production one.
   ```sh
   node apps/site/scripts/docs-shots/capture.mjs data-account                     # whole section
   node apps/site/scripts/docs-shots/capture.mjs data-account data/project-trash  # one shot
   ```
   Output: `apps/site/public/images/docs/<name>-light.webp` plus an updated `manifest.json`. Light mode only, by product decision.

## Preview

`pnpm --filter @margaya/site dev`, then open http://localhost:3001/docs (see `apps/docs/README.md`). Stop only the server you started.

## Done when

- [ ] `pnpm openapi:check` reports up to date (whenever any route, request or response schema changed).
- [ ] Every new or renamed operation has an endpoint page listed in `docs.json`.
- [ ] New guides are in `docs.json`; moved pages have a redirect.
- [ ] `pnpm --filter @margaya/site test` passes, and `pnpm --filter @margaya/site build` succeeds when docs.json, pages or screenshots changed (it fails on missing pages, titles or screenshot names).
- [ ] Optional, for nav and reference wiring: `E2E_DOCS_SITE=1 pnpm e2e --project=docs-site` (PowerShell: `$env:E2E_DOCS_SITE=1; pnpm e2e --project=docs-site`); see the `testing` skill.
