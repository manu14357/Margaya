---
name: integration-plugin
description: Workflow for adding or changing a project integration plugin in apps/api/src/plugins (github, gitea, slack, discord, mattermost, telegram, generic-webhook) - plugin registry, event hooks, Valibot config validation, outbound destination checks, secret masking, the settings routes and UI, docs and tests. Use when adding a new chat or webhook integration, adding an event an integration reacts to, or changing integration config.
---

# Integration plugin

A project integration is one `integration` row (`projectId`, `type`, `config` as JSON text, `isActive`) plus a plugin that reacts to task events. Mattermost is the smallest complete example. Read these together:
`apps/api/src/plugins/mattermost/` (plugin), `apps/api/src/mattermost-integration/` (HTTP routes), `apps/web/src/components/project/mattermost-integration-settings.tsx` (UI), `apps/docs/core/integrations/mattermost.mdx` (docs).

Workspace-level outgoing webhooks are a separate system (`apps/api/src/webhook/`). This skill covers per-project plugins only.

## 1. The plugin

Create `apps/api/src/plugins/<type>/` with the same four files as Mattermost:
- `config.ts`: a Valibot schema (`import * as v from "valibot"`, the convention under `plugins/`), event-toggle keys with defaults (`defaultMattermostEvents`), a `normalize...Config()` and a `validate...Config()` that returns `{ valid, errors }`. Copy `apps/api/src/plugins/mattermost/config.ts`.
- `client.ts`: the outbound call. Copy `postToMattermost()`: call `assertPublicWebhookDestination()` (from `plugins/generic-webhook/config.ts`, built on `apps/api/src/utils/assert-public-destination.ts`) **before every send**, set a timeout with `AbortController`, and use `redirect: "error"`. Private addresses are refused unless the operator sets `MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true`.
- `events.ts`: one handler per hook, typed `TaskEventHandler<...>` from `apps/api/src/plugins/types.ts`. Each handler normalizes `context.config`, returns early when the event toggle is off, and loads what it needs by id (see `getMattermostEventData()`). Never trust payload fields for anything private.
- `index.ts`: the `IntegrationPlugin` object (`type`, `name`, `on...` hooks, `validateConfig`).

Register it in `initializePlugins()` in `apps/api/src/plugins/index.ts` with `registerPlugin(myPlugin)`. Registering a `type` twice throws.

## 2. Events a plugin can receive

`initializeEventSubscriptions()` in `apps/api/src/plugins/registry.ts` subscribes once to the internal events (`task.created`, `task.status_changed`, `comment.created`, `task.moved`...). Each `broadcast...()` function there:
- loads the project's active integrations (`getActiveIntegrations`). A trashed project's integrations stay quiet.
- skips tasks still waiting in intake (`integrationsForTask` with `triageTaskIds`). An unreviewed request never reaches chat or issue sync.
- calls each plugin's hook inside its own `try/catch`, so one failing plugin never affects another or the mutation.

To support a **new event** for plugins:
1. Add its payload type to `apps/api/src/plugins/types.ts`, plus the `TaskEvent` union and an optional `on...` hook on `IntegrationPlugin`.
2. Add a `subscribeToEvent` block in `initializeEventSubscriptions()` and a `broadcast...()` function shaped like `broadcastTaskCreated`.
3. Add the toggle to the plugin's config and defaults, and to `integrationEventToggles` / `integrationEventsSchema` in `apps/api/src/integrations/schema.ts` and `response.ts` if the HTTP API exposes it.
4. Make sure the event is published at all. See the [realtime-events](../realtime-events/SKILL.md) skill.

Comments carry `origin` and `visibility` (`TaskCommentCreatedEvent`). Decide whether public-board or internal comments may leave the instance.

## 3. Secrets

- `config` is stored as plain JSON text in `integration.config`. Webhook URLs, bot tokens and signing secrets are bearer credentials.
- Responses never return them. They return `webhookConfigured: boolean` plus a masked form. See `maskWebhookUrl()` / `toResponse()` in `apps/api/src/mattermost-integration/index.ts` and the comment in its `response.ts`. The generic webhook does the same for its `secret` (`secretConfigured`, `maskedSecret`).
- Never log the config, the URL or an error that contains them. `tests/api/plugins/telegram-logging.test.ts` checks this for Telegram.
- Updates merge: an omitted field keeps the stored value, so the client never needs to read a secret back.

## 4. Settings routes

Create `apps/api/src/<type>-integration/` with `index.ts`, `schema.ts` and `response.ts`, copying the Mattermost module. Follow the [api-endpoint](../api-endpoint/SKILL.md) skill. Integration-specific points:
- `GET /project/{projectId}` needs only `workspaceAccess.fromProject("projectId")`. Create, update and delete also need `requireWorkspacePermission({ workspace: ["manage_settings"] })`.
- Run `validate...Config()` before every write and turn its errors into `HTTPException(400)`.
- Mount it in `apps/api/src/index.ts` (`api.route("/<type>-integration", ...)`), add it to `AppType`, and add the type to `PROVIDERS` in `apps/api/src/audit-log/http-rules.ts` so connect, update and disconnect are audited.
- Regenerate `apps/docs/openapi.json` (`pnpm openapi:check:fix`) and add reference pages under `apps/docs/api-reference/endpoints/<type>/`.

## 5. Web UI

- Fetchers: `apps/web/src/fetchers/<type>-integration/`. Hooks: `apps/web/src/hooks/queries/<type>-integration/` and `apps/web/src/hooks/mutations/<type>-integration/`.
- Settings card in `apps/web/src/components/project/<type>-integration-settings.tsx`, rendered from `apps/web/src/routes/_layout/_authenticated/dashboard/settings/projects/$projectId/integrations.tsx`.
- Show the current state (connected, masked destination, enabled events), with connect, update, disable and disconnect. Copy goes in `i18n/en-US.json` and every locale file.

## 6. Docs

Add `apps/docs/core/integrations/<type>.mdx` (frontmatter `title`, `description`; copy `mattermost.mdx`) and list it in the integrations group of `apps/docs/docs.json`, next to `core/integrations/mattermost`. Explain where the user gets the URL or token, which events exist and which are on by default, and the private-destination override for self-hosters.

## 7. Tests

- Config: `tests/api/plugins/mattermost-config.test.ts` (private destination refused by default, override allowed, empty URL refused).
- Registry: `tests/api/plugins/registry-task-created.test.ts` (mocks `events`, `database` and `intake/guards`, then registers a probe plugin).
- Routes end to end: `tests/api-integration/mattermost-integration.test.ts`. It uses `vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true")` and asserts that responses mask the secret.
- Intake: `tests/api-integration/intake-integrations.test.ts` ("sends nothing while a request waits").

## Done when

- [ ] The plugin is registered in `initializePlugins()` and `validateConfig` rejects bad and private destinations
- [ ] No response, log line or event carries a raw secret (with a test)
- [ ] `pnpm --filter @margaya/api test:unit tests/api/plugins` passes
- [ ] `pnpm --filter @margaya/api test:integration tests/api-integration/<type>-integration.test.ts` passes
- [ ] `pnpm openapi:check` is clean; docs page and reference pages are in `apps/docs/docs.json`
- [ ] `pnpm --filter @margaya/api typecheck`, `pnpm --filter @margaya/web typecheck` and `pnpm i18n:check` pass
