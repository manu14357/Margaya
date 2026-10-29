# Margaya Docs

This directory contains the Margaya documentation content. The public website
(`apps/site`) renders it at `/docs`.

## Monorepo setup

- Content root: `/apps/docs`
- Navigation config: `apps/docs/docs.json`
- OpenAPI source file: `apps/docs/openapi.json` (regenerate with `pnpm openapi:check:fix`)

## Local preview

Run the site dev server from the repository root:

```bash
pnpm --filter @margaya/site dev
```

Then open `http://localhost:3001/docs`.

To preview the production build in Docker instead:

```bash
docker compose -f compose.local.yml up -d --build site
```

## Content structure

- `index.mdx`: docs landing page
- `core/**`: product and deployment guides
- `api-reference/**`: overview/auth pages
- `api-reference/endpoints/**`: one hand-written page per operation in `openapi.json`, each listed in `docs.json`; the page body is rendered from the spec
