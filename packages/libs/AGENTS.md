# packages/libs

The web app's only request layer: the typed Hono client (`client`), the per-tab `windowId`, `resolveApiBaseUrl` and the `streamAi` SSE helper. Exported from `src/index.ts`. Follow the root [AGENTS.md](../../AGENTS.md); skills: `web-data-flow`, `api-endpoint`.

## How the client type works

- `client` is `hc<AppType>(...)`. `AppType` is a hand-maintained union of router types at the bottom of `apps/api/src/index.ts`. A router that is mounted in `createApp()` but missing from that union is invisible to the client, so web code calling it fails to typecheck. Add new routers to the union.
- Request and response types come from the routes' Zod schemas and handler return types. Changing a route's path, method, params or response shape is a breaking change for every web fetcher that calls it; typecheck the web app after any API route change.
- The package ships source (`main` and `types` point at `src/index.ts`), so there is no build step. `@margaya/api` is a dev dependency used for types only; never import API runtime code here.

## Rules

- Web requests go through `client` from a fetcher in `apps/web/src/fetchers/`. Do not add `fetch` wrappers, axios instances or another client here or in the web app.
- The Hono client cannot read Server-Sent Events. AI streaming uses `streamAi`; callers pass it the same API base URL (ending in `/api`) and `windowId` that `client` uses, and it sends credentials. Do not add a second streaming helper.
- Every request sends `X-Margaya-Window-Id: windowId`. The API combines it with the user id as the event initiator so a tab can skip echoes of its own realtime events. Keep the header on any new request path.
- `client` adds `Content-Type: application/json` except for `FormData` bodies; uploads depend on that exception.
- The base URL comes from `VITE_API_URL` through `resolveApiBaseUrl`, which appends `/api` unless it is already there. Both bundled same-origin and separately hosted API deployments depend on this; keep the tests in `src/api-url.test.ts` passing.
- Code here runs in the browser bundle. Keep it free of Node-only APIs and secrets.

## Verify

- `pnpm --filter @margaya/libs test` and `pnpm --filter @margaya/libs typecheck`.
- After an API route or `AppType` change: `pnpm --filter @margaya/web typecheck`.
