# apps/docs

Documentation content only: Mintlify-compatible MDX plus `docs.json`. There is no package here and no Mintlify build. `apps/site` reads these files from disk and renders them at `/docs` (`apps/site/lib/docs/source.ts`, `markdown.ts`, `openapi.ts`). Follow the root [AGENTS.md](../../AGENTS.md); skill: `docs-and-openapi`.

## Pages

- `docs.json` is the sidebar. A page listed there must exist as `<id>.mdx`, or the site build throws. A page not listed is still published, as a hidden page.
- Frontmatter is flat `key: value` lines. The site reads only `title` (required, or the build throws), `description`, `openapi` and `mode: landing`. Other Mintlify keys are ignored.
- Folders named `drafts` and files ending in `.draft.mdx` are skipped unless `docs.json` lists them (`api-reference/endpoints/drafts/` only works because it is listed).
- Links starting with `/` are relative to the docs root (`/core/functional/cycles`), as in Mintlify. Renames need a `redirects` entry in `docs.json`.
- Only the components handled in `apps/site/lib/docs/markdown.ts` render: `Note`, `Info`, `Tip`, `Check`, `Warning`, `Danger`, `Steps`/`Step`, `Card`, `CardGroup`/`Columns`, `AccordionGroup`/`Accordion`, `Frame`, `Screenshot`, `Kbd`, `ButtonGroup`/`Button`, `CodeGroup`, `Tabs`/`Tab`. Anything else is dropped with a build warning.
- Use the product terms from the root glossary (workspace, project, column, role).

## API reference

- `openapi.json` is generated from the API. Never edit it by hand: run `pnpm openapi:check:fix` from the repo root after any route, request schema or response schema change. CI runs `pnpm openapi:check`.
- Endpoint pages are small hand-written stubs, one per operation, under `api-reference/endpoints/<tag-folder>/<operationId>.mdx`:

  ```mdx
  ---
  title: createProject
  description: Create a new project in a workspace
  openapi: 'POST /project'
  ---
  ```

  The `openapi` value must match a method and path in `openapi.json` exactly (path without the `/api` prefix). The sidebar label comes from the operation's `summary`. Stubs are written by hand: a new operation needs its stub and its `docs.json` entry, and a removed operation needs both deleted. The e2e spec `tests/e2e/specs/docs-site/api-reference.spec.ts` fails when an operation has no page or a page points at a missing operation.

## Screenshots

- `<Screenshot src="area/name" alt="..." caption="..." />` looks `src` up in `apps/site/public/images/docs/manifest.json`. An unknown name fails the site build and tests (dev shows a placeholder).
- Shots are light mode only and come from `node apps/site/scripts/docs-shots/capture.mjs <section> [names...]`, with specs in `apps/site/scripts/docs-shots/specs/<section>.mjs`. It needs a running local API and web app, Microsoft Edge and the `tests/e2e` Playwright install, and it seeds the fictional "Studio North" workspace through the API. Never point it at a real instance.
- Write `alt` text that describes what the screenshot shows.

## Verify

- `pnpm --filter @margaya/site test` renders every page and checks that every screenshot exists.
- Preview with `pnpm --filter @margaya/site dev`, then open `/docs` on port 3001.
