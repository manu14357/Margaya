import { windowId } from "@margaya/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { invalidateEstimateQueries } from "@/hooks/mutations/estimate/invalidate-estimate-queries";
import { invalidateIntakeQueries } from "@/hooks/mutations/intake/invalidate-intake-queries";
import { invalidatePlanningProgress } from "@/hooks/mutations/task/invalidate-planning-progress";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { intakeQueryKeys } from "@/hooks/queries/intake/intake-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { descriptionVersionKeys } from "@/hooks/queries/task-description-version/keys";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { authClient } from "@/lib/auth-client";
import { handlePageHint } from "@/lib/pages/page-realtime";
import {
  createBatchedRefresh,
  markProjectSocketLive,
} from "@/lib/project-realtime";
import { onWake, reconnectDelay } from "@/lib/realtime-reconnect";
import { onSignOut } from "@/lib/sign-out";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

export function getWsUrl(projectId: string) {
  const base = getApiUrl("ws");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}

/** Messages that change which tasks a task query returns, or their groups. */
const TASK_QUERY_HINTS = new Set([
  "TASK_UPDATED",
  "TASK_CREATED",
  "TASK_DELETED",
  "TASK_RESTORED",
  "TASK_LABEL_UPDATED",
  "TASK_MOVED",
  "TASK_RELATION_UPDATED",
  "COLUMNS_UPDATED",
  "CYCLE_UPDATED",
  "MODULE_UPDATED",
  "ESTIMATE_TASKS_REMAPPED",
  "TASKS_CHANGED",
  "CUSTOM_FIELDS_UPDATED",
]);

/** Messages that change archived counts or lists (B11 Archives). */
const ARCHIVE_HINTS = new Set([
  "TASK_UPDATED",
  "TASK_DELETED",
  "TASK_RESTORED",
  "TASKS_CHANGED",
  "PROJECT_UPDATED",
  "CYCLE_UPDATED",
  "MODULE_UPDATED",
]);

/** Messages that change a trash list (C7). */
const TRASH_HINTS = new Set([
  "TASK_DELETED",
  "TASK_RESTORED",
  "TASK_PURGED",
  "PROJECT_UPDATED",
]);

// When each project's socket last closed (navigating away, a dropped
// connection). Queries don't refetch on mount, so changes made meanwhile by
// people, agents or automations are caught up when it opens again.
const closedAt = new Map<string, number>();

/** Forgets closed sockets: a new session starts with an empty cache. */
export function forgetClosedProjectSockets() {
  closedAt.clear();
}
onSignOut(forgetClosedProjectSockets);

/** Everything a project's live messages keep current, refreshed at once. */
function catchUpProject(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  void invalidateTaskQueries(queryClient, projectId);
  for (const queryKey of [
    ["tasks", projectId],
    ["projects"],
    ["custom-fields", projectId],
    ["custom-field-values"],
    intakeQueryKeys.lists(projectId),
    intakeQueryKeys.summary(projectId),
    moduleQueryKeys.taskMap(projectId),
    pageQueryKeys.list(projectId),
    pageQueryKeys.taskReferences(),
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
  invalidatePlanningProgress(queryClient, projectId);
  // Open task details, comments and history refetch; ones not on screen are
  // dropped so they load fresh when opened.
  for (const queryKey of [
    ["task"],
    ["activities"],
    ["comments"],
    ["task-relations"],
    ["labels"],
  ]) {
    queryClient.removeQueries({ queryKey, type: "inactive" });
    queryClient.invalidateQueries({ queryKey });
  }
}

/** Close code of a project socket whose access was revoked (API ws/index.ts). */
const PROJECT_ACCESS_REVOKED = 4404;

// Cloudflare closes idle WebSocket connections after 100 seconds of no traffic.
// We send a lightweight ping every 30 seconds to keep the connection alive.
const WS_PING_INTERVAL_MS = 30_000;

export function useProjectWebSocket(projectId: string) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!projectId || !session?.user?.id) return;

    // Each effect owns its sockets and timers. Late events from an old project
    // or session must not alter the next effect's connection or reconnect it.
    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retries = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let releaseLive: (() => void) | null = null;

    // Bulk edits arrive as one message per task. What they refresh is costly
    // (a whole board, task lists, planning charts), so it runs in batches;
    // queries for one task below stay immediate.
    const refreshes = createBatchedRefresh();
    const refreshBoard = (id: string) =>
      refreshes.schedule(`board:${id}`, () =>
        queryClient.invalidateQueries({ queryKey: ["tasks", id] }),
      );
    const refreshTaskQueries = (id: string) =>
      refreshes.schedule(`task-query:${id}`, () =>
        invalidateTaskQueries(queryClient, id),
      );
    const refreshPlanning = (id: string) =>
      refreshes.schedule(`planning:${id}`, () =>
        invalidatePlanningProgress(queryClient, id),
      );

    function clearPing() {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    function connect() {
      if (disposed) return;
      retryTimeout = null;
      const url = getWsUrl(projectId);
      const ws = new WebSocket(url);
      activeSocket = ws;

      ws.onopen = () => {
        if (disposed || activeSocket !== ws) return;
        retries = 0; // Reset retries on successful connection
        releaseLive?.();
        releaseLive = markProjectSocketLive(projectId);
        if (closedAt.has(projectId)) {
          closedAt.delete(projectId);
          catchUpProject(queryClient, projectId);
        }
        // Start keepalive pings to prevent Cloudflare idle timeout (100s)
        clearPing();
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (disposed || activeSocket !== ws) return;
        try {
          const message = JSON.parse(event.data);
          // Who can see the project changed (restricted projects): the
          // member list and the project lists refresh.
          if (message.type === "PROJECT_ACCESS_CHANGED") {
            queryClient.invalidateQueries({
              queryKey: ["project-access", message.projectId],
            });
            // Its pickers' people, and my own project role there.
            queryClient.invalidateQueries({
              queryKey: ["project-audience", message.projectId],
            });
            queryClient.invalidateQueries({ queryKey: ["project-rights"] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            return;
          }
          // Task query results (filters, spreadsheets, views) follow every
          // change to the project's tasks and what groups them; only
          // mounted queries refetch.
          if (TASK_QUERY_HINTS.has(message.type)) {
            refreshTaskQueries(message.projectId);
          }
          // Archive counts and lists (archive, restore, delete, automation).
          if (ARCHIVE_HINTS.has(message.type)) {
            queryClient.invalidateQueries({
              queryKey: archiveQueryKeys.all(),
            });
          }
          // Trash lists (C7): a task moved to the trash, restored or deleted
          // permanently, or the project itself trashed or restored.
          if (TRASH_HINTS.has(message.type)) {
            queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
          }
          // A project view was created, changed or deleted: its lists, open
          // views and favorites refresh (the hint carries no view data).
          // Intake requests changed (submitted, triaged, edited, deleted, or
          // a snooze ended): the queue, its badge and the request refresh.
          if (message.type === "INTAKE_UPDATED") {
            invalidateIntakeQueries(queryClient, {
              projectId: message.projectId,
              taskId: message.taskId,
            });
            return;
          }
          if (message.type === "VIEWS_UPDATED") {
            queryClient.invalidateQueries({ queryKey: ["views"] });
            queryClient.invalidateQueries({ queryKey: ["favorites"] });
            return;
          }
          // Pages changed (lists, trees, headers, favorites); open editors
          // get content over their own page socket.
          if (handlePageHint(queryClient, message)) return;
          // Column and project-setting changes are refetch hints; statistics
          // live on the project queries, so those refresh too.
          if (message.type === "COLUMNS_UPDATED") {
            queryClient.invalidateQueries({
              queryKey: ["columns", message.projectId],
            });
            refreshBoard(message.projectId);
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            // A column's group decides which tasks are open or done: cycle
            // and module progress, forecasts and risks.
            refreshPlanning(message.projectId);
            return;
          }
          // A custom field was added, edited or removed. Renaming an option
          // also rewrites task values, so open tasks refetch theirs.
          if (message.type === "CUSTOM_FIELDS_UPDATED") {
            for (const queryKey of [
              ["custom-fields", message.projectId],
              ["custom-field-values"],
              ["custom-field-filter-values", message.projectId],
            ]) {
              queryClient.invalidateQueries({ queryKey });
            }
            return;
          }
          // Settings, automations, or the archive state: favorites hide
          // archived projects.
          if (message.type === "PROJECT_UPDATED") {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            queryClient.invalidateQueries({ queryKey: ["favorites"] });
            return;
          }
          // The automation job archived or closed many tasks at once: one
          // hint for all of them, so everything showing tasks refreshes by
          // prefix; only mounted queries refetch.
          if (message.type === "TASKS_CHANGED") {
            refreshBoard(message.projectId);
            for (const queryKey of [
              ["task"],
              ["activities"],
              ["task-relations"],
              ["projects"],
              ["custom-field-values"],
            ]) {
              queryClient.invalidateQueries({ queryKey });
            }
            refreshPlanning(message.projectId);
            return;
          }
          // Cycle changes refresh favorites, whose names and archive state
          // may have changed, and the planning refresh: cycle lists, details
          // and progress, and the forecasts and risks that read a cycle's end
          // date. A membership change also sends one TASK_UPDATED per task,
          // which asks for the same planning refresh, so it runs once.
          if (message.type === "CYCLE_UPDATED") {
            queryClient.invalidateQueries({ queryKey: ["favorites"] });
            refreshPlanning(message.projectId);
            return;
          }
          // Module changes refresh every module query of the project, the
          // favorites (names, archive state), task activity (membership
          // entries) and the forecasts and risks that read a module's target
          // date and tasks; only mounted queries refetch.
          if (message.type === "MODULE_UPDATED") {
            queryClient.invalidateQueries({
              queryKey: moduleQueryKeys.all(message.projectId),
            });
            queryClient.invalidateQueries({ queryKey: ["favorites"] });
            queryClient.invalidateQueries({ queryKey: ["activities"] });
            invalidateDeliveryQueries(queryClient, message.projectId);
            return;
          }
          // Estimate system changes refresh the systems and the cycle and
          // module progress whose estimate totals follow them. A remap also
          // moved tasks between values: one hint for any number of tasks,
          // so the board, open tasks and activity feeds refresh by prefix.
          if (
            message.type === "ESTIMATE_UPDATED" ||
            message.type === "ESTIMATE_TASKS_REMAPPED"
          ) {
            invalidateEstimateQueries(queryClient, message.projectId);
            if (message.type === "ESTIMATE_TASKS_REMAPPED") {
              refreshBoard(message.projectId);
              queryClient.invalidateQueries({ queryKey: ["task"] });
              queryClient.invalidateQueries({ queryKey: ["activities"] });
            }
            return;
          }
          // The project's public board was published, unpublished, changed,
          // got a new link, or someone was blocked (B12 §5). The project
          // queries carry the isPublic mirror.
          if (message.type === "PUBLICATION_UPDATED") {
            for (const key of [
              "publication",
              "public-comments",
              "publication-blocks",
            ]) {
              queryClient.invalidateQueries({
                queryKey: [key, message.projectId],
              });
            }
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            return;
          }
          // Someone voted on the public board: the task's read-only summary.
          if (message.type === "VOTES_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["task-votes", message.taskId],
              });
            }
            return;
          }
          // Links and attachments are not part of the board payload, so the
          // board is not refetched for them; the task's panel and its
          // history are.
          if (message.type === "TASK_LINKS_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["task-links", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
            }
            return;
          }
          // A coding-agent handoff moved: its timeline, and the pull
          // request links it came with.
          if (message.type === "CODING_HANDOFF_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["coding-agent", "task", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["external-links", message.taskId],
              });
            }
            return;
          }
          // Reactions are not part of the board or the activity feed.
          if (message.type === "REACTIONS_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["reactions", message.taskId],
              });
            }
            return;
          }
          if (message.type === "TASK_ATTACHMENTS_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["task-attachments", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
            }
            return;
          }
          if (
            message.type === "TASK_UPDATED" ||
            message.type === "TASK_CREATED" ||
            message.type === "TASK_DELETED" ||
            message.type === "TASK_RESTORED" ||
            message.type === "TASK_LABEL_UPDATED" ||
            message.type === "TASK_MOVED" ||
            message.type === "TASK_RELATION_UPDATED" ||
            message.type === "COMMENT_UPDATED"
          ) {
            // Comments are not part of the board payload or planning totals.
            if (message.type !== "COMMENT_UPDATED") {
              refreshBoard(message.projectId);
              // Cycle and module counts, progress and charts follow task
              // status.
              refreshPlanning(message.projectId);
            }
            // The module task map only changes when a task leaves the project.
            if (
              message.type === "TASK_DELETED" ||
              message.type === "TASK_RESTORED" ||
              message.type === "TASK_MOVED"
            ) {
              queryClient.invalidateQueries({
                queryKey: moduleQueryKeys.taskMap(message.projectId),
              });
            }
            // Relations to a trashed task hide while it is in the trash and
            // come back with a restore, on the other tasks too (C7).
            if (
              message.type === "TASK_DELETED" ||
              message.type === "TASK_RESTORED"
            ) {
              queryClient.invalidateQueries({ queryKey: ["task-relations"] });
            }
            // Custom field values aren't in the board payload.
            if (message.type === "TASK_UPDATED" && message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["custom-field-values", message.taskId],
              });
            }
            // Intake rows show their task's title and priority, and a
            // deleted request's task takes the request along.
            if (
              message.type === "TASK_UPDATED" ||
              message.type === "TASK_DELETED"
            ) {
              queryClient.invalidateQueries({
                queryKey: intakeQueryKeys.lists(message.projectId),
              });
              queryClient.invalidateQueries({
                queryKey: intakeQueryKeys.summary(message.projectId),
              });
            }

            if (message.type === "TASK_RELATION_UPDATED") {
              // Each task it names lists the relation and records it in its
              // history. Across projects, a project's message names only its
              // own task; the other refreshes when its project's socket opens.
              for (const relatedTaskId of [
                message.sourceTaskId,
                message.targetTaskId,
              ]) {
                if (!relatedTaskId) continue;
                queryClient.invalidateQueries({
                  queryKey: ["task", relatedTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", relatedTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["activities", relatedTaskId],
                });
              }
              if (!message.sourceTaskId && !message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task-relations"],
                });
              }
              // The timeline's dependency lines.
              queryClient.invalidateQueries({
                queryKey: ["task-relations", "project"],
              });
            } else {
              queryClient.invalidateQueries({
                queryKey: ["task", message.taskId],
              });
            }

            // Another user's edit (an estimate, a label, a date) adds a
            // history entry; an open activity feed refreshes with it.
            if (message.taskId && message.type !== "TASK_RELATION_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
            }

            // A description edit adds or updates a saved version; an open
            // history list catches up.
            if (message.taskId && message.type === "TASK_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: descriptionVersionKeys.list(message.taskId),
              });
            }

            if (message.type === "TASK_LABEL_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["labels", message.taskId],
              });
            }

            if (message.type === "COMMENT_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["comments", message.taskId],
              });
              // The Publish page lists the project's public comments.
              queryClient.invalidateQueries({
                queryKey: ["public-comments", message.projectId],
              });
              // A deleted comment takes its reactions along.
              queryClient.invalidateQueries({
                queryKey: ["reactions", message.taskId],
              });
            }

            // Commenting, being mentioned or being assigned subscribes
            // people silently; an open subscribe button catches up.
            if (
              message.taskId &&
              (message.type === "COMMENT_UPDATED" ||
                message.type === "TASK_UPDATED")
            ) {
              queryClient.invalidateQueries({
                queryKey: ["task-subscription", message.taskId],
              });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        releaseLive?.();
        releaseLive = null;
        activeSocket = null;
        closedAt.set(projectId, Date.now());

        // 4404: access to the project was revoked. Reconnecting would be
        // refused; the project lists refetch and drop it instead.
        if (event.code === PROJECT_ACCESS_REVOKED) {
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          return;
        }
        retryTimeout = setTimeout(connect, reconnectDelay(retries));
        retries += 1;
      };
    }
    function dispose() {
      disposed = true;
      if (activeSocket?.readyState === WebSocket.OPEN) {
        closedAt.set(projectId, Date.now());
      }
      clearPing();
      releaseLive?.();
      releaseLive = null;
      refreshes.dispose();
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      activeSocket?.close();
    }

    // Close before the session ends, so no reconnect races the sign-out.
    const stopOnSignOut = onSignOut(dispose);
    // Back in view or online: reconnect now rather than after the backoff.
    const stopWake = onWake(() => {
      refreshes.wake();
      if (disposed || retryTimeout === null) return;
      clearTimeout(retryTimeout);
      connect();
    });
    connect();

    return () => {
      stopWake();
      stopOnSignOut();
      dispose();
    };
  }, [projectId, session?.user?.id, queryClient]);
}
