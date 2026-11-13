---
name: realtime-events
description: Follows a mutation from publishEvent() through its subscribers (activity, notifications, plugins, webhooks, audit log) to project- or user-scoped WebSocket hints, optional Redis fan-out and the web cache update. Use when a mutation should update other clients live, when adding or renaming an event, when adding a WebSocket message type, or when a change "does not show up until refresh".
---

# Realtime events

One mutation, one event, many listeners. The API publishes an internal event. Subscribers turn it into history, notifications, outbound integrations and a small WebSocket **hint**. Clients answer a hint by refetching. Hints carry ids only, never entity data, so private content never travels over a socket.

## The path

```
controller --publishEvent()--> apps/api/src/events/index.ts (in-process EventEmitter)
  |- activity / task history   apps/api/src/activity/index.ts, apps/api/src/task-activity/subscribers.ts
  |- notifications             apps/api/src/notification/subscribers.ts
  |- project plugins           apps/api/src/plugins/registry.ts (initializeEventSubscriptions)
  |- workspace webhooks        apps/api/src/webhook/catalog.ts + webhook/subscribers.ts
  |- automations, audit log    apps/api/src/automation-rule/subscribers.ts, apps/api/src/audit-log/capture-events.ts
  `- WebSocket hints           apps/api/src/ws/index.ts
        broadcastToProject() / broadcastToUser()
        -> BroadcastAdapter: in-memory-broadcast-adapter.ts, or redis-broadcast-adapter.ts when Redis is configured
        -> local connections -> apps/web/src/hooks/use-project-websocket.ts / use-user-websocket.ts -> TanStack Query cache
```

## 1. Publish the event

- Call `publishEvent(eventType, payload)` from `apps/api/src/events` after the write succeeds. Example: `apps/api/src/label/controllers/create-label.ts` publishes `task.label_created` with `{ projectId, taskId, userId, label, type }`.
- Names are `<entity>.<past_tense>` (`task.label_created`, `cycle.tasks_changed`). Reuse an existing name if the meaning is the same.
- Payloads carry ids and the minimum each subscriber needs. Include `projectId` for project hints and `userId` for the actor. Subscribers may run on a payload from an older publisher, so keep fields optional where they already are.
- `initiatorId` is added for you. `eventContext` (set per request in `apps/api/src/index.ts` from `X-Margaya-Window-Id`) lets the socket skip the tab that made the change.
- `publishEvent(..., { waitForHandlers: true })` awaits the subscribers. Use it only for bounded batch producers.

## 2. Subscribers

- Add a handler with `subscribeToEvent<Payload>(name, async (data) => ...)`. Errors are caught and logged per handler, so one failing subscriber never breaks the mutation.
- Subscriber files are side-effect imports. A new `subscribers.ts` must be imported from its feature's `index.ts` (e.g. `import "./subscribers";` in `apps/api/src/notification/index.ts`), or it never registers.
- Decide each listener on purpose:
  - **Activity / history**: `apps/api/src/task-activity/subscribers.ts` maps events to activity types (`["task.label_created", "label_added"]`).
  - **Notifications**: `apps/api/src/notification/subscribers.ts`. The audience is decided by `notifyTaskEvent()` in `notification/recipients.ts`, never by payload fields.
  - **Plugins** (Slack, Discord, GitHub...): see the [integration-plugin](../integration-plugin/SKILL.md) skill.
  - **Workspace webhooks**: add the internal event as a source in `apps/api/src/webhook/catalog.ts` (see the `"task.label_added"` entry). `webhook/subscribers.ts` subscribes to every `WEBHOOK_SOURCE_EVENTS` entry automatically.

## 3. WebSocket hint (API side)

All in `apps/api/src/ws/index.ts`:
- **Task events**: add the name to `taskUpdateEvents`. The loop at the bottom maps it to a message type (default `TASK_UPDATED`) and needs `projectId` and `taskId` in the payload.
- **Project-level events**: copy a block like the `view.created / view.updated / view.deleted` loop. It calls `broadcastToProject(projectId, { type: "VIEWS_UPDATED", projectId, taskId: "" }, initiatorId)`.
- **Per-user data** (drafts, favorites, inbox): `broadcastToUser(userId, { type: "FAVORITES_UPDATED", workspaceId })`. The user channel does not exclude the initiator.
- **Workspace-wide data** that tabs without a project socket show (profiles, the workspace, the project list, labels, workspace views, favorites and recents): `apps/api/src/ws/workspace-hints.ts`, with audiences from `ws/audience.ts` (`broadcastToWorkspace`, co-members, favorite and recent holders). Hints name no project, so restricted projects stay hidden. The web side is `apps/web/src/lib/workspace-realtime.ts`.
- **Native consumers.** `/api/ws/user` is also held by the desktop app's Rust core, authenticated with a bearer token. It raises an OS notification for `NOTIFICATION_CREATED` by fetching `GET /api/notification/{id}/desktop` with the hint's `notificationId`, and updates its badge from the unread count. Keep that hint's type and `notificationId` stable, and keep every user hint ids-only: a desktop client may log or persist what it receives. See the `desktop-app` skill.
- `broadcastToProject()` batches per project for 100 ms and dedupes on type and ids. The project socket only accepts users who can see the project. Restricted-project access changes go through `PROJECT_ACCESS_CHANGED`.
- **Redis**: multi-instance delivery goes through `RedisBroadcastAdapter`, which validates incoming project messages with `broadcastMessageSchema` in `apps/api/src/ws/redis-broadcast-adapter.ts`. That schema lists the allowed fields, so a new field on `ProjectBroadcastMessage` (`apps/api/src/ws/broadcast-adapter.ts`) is dropped across instances unless you add it there too. User messages use a loose schema. Redis stays optional: `isRedisConfigured()` (`apps/api/src/redis/index.ts`) chooses the adapter, and single-instance installs use the in-memory one.

## 4. Web cache update

- Project hints: `apps/web/src/hooks/use-project-websocket.ts`. Add an `if (message.type === "...")` branch that invalidates exactly the affected keys (see `COLUMNS_UPDATED`). If the hint changes which tasks a query returns, add it to `TASK_QUERY_HINTS`. Add it to `ARCHIVE_HINTS` / `TRASH_HINTS` if it changes those lists.
- User hints: `apps/web/src/hooks/use-user-websocket.ts` (see `FAVORITES_UPDATED`, `DRAFTS_UPDATED`).
- Use the feature's query-key helpers (e.g. `moduleQueryKeys` in `apps/web/src/hooks/queries/module/module-query-keys.ts`) so keys match the hooks.
- The tab that made the change updates its own cache in the mutation hook (`onSuccess`); the socket is for everyone else.

## 5. Tests

- Event to socket, in-memory adapter: copy `tests/api/ws/view-events.test.ts`. It calls `initializeWebSocketAdapter()`, adds fake connections with `addConnection()`, publishes inside `eventContext.run({ initiatorId })`, and asserts the exact JSON other windows get and that the initiator gets nothing.
- Redis path: `tests/api/ws/page-broadcast-redis.test.ts` and `tests/api/ws/user-broadcast-redis-failure.test.ts` mock `apps/api/src/redis`.
- Subscribers end to end: `tests/api-integration/project-events.test.ts`, `tests/api-integration/webhook-events-coverage.test.ts`.
- Web: `apps/web/src/hooks/use-project-websocket-lifecycle.test.tsx` sends a message and asserts the exact `invalidateQueries` calls.

## Done when

- [ ] The mutation publishes exactly one event per change, after the write
- [ ] Each relevant subscriber handles it (activity, notifications, plugins, webhooks), and new subscriber files are imported
- [ ] `pnpm --filter @margaya/api test:unit tests/api/ws` passes, with a test for the new hint
- [ ] Any new `ProjectBroadcastMessage` field is also in `broadcastMessageSchema`
- [ ] `pnpm --filter @margaya/web test src/hooks` passes, with a test for the new branch
- [ ] `pnpm --filter @margaya/api typecheck` and `pnpm --filter @margaya/web typecheck` pass
- [ ] A change to a user hint the desktop core reads (`NOTIFICATION_CREATED`, `NOTIFICATIONS_UPDATED`) keeps working for installed shells
