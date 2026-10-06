import { windowId } from "@margaya/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import { authClient } from "@/lib/auth-client";
import { handleHomeUserMessage } from "@/lib/home-realtime";
import { onSignOut } from "@/lib/sign-out";
import { handleTaskExportUserMessage } from "@/lib/task-export/realtime";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

export function getUserWsUrl() {
  const base = getApiUrl("ws");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/user?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000;
const WS_PING_INTERVAL_MS = 30_000;

/**
 * Maintains a user-scoped WebSocket connection for receiving user-targeted
 * real-time events (e.g. NOTIFICATION_CREATED). Invalidates TanStack Query
 * caches as needed, so no polling is required.
 */
export function useUserWebSocket() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  useEffect(() => {
    if (!session?.user?.id) return;

    // A previous session's delayed socket events must not control this session.
    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retries = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;

    function clearPing() {
      if (pingInterval !== null) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    }

    function connect() {
      if (disposed) return;
      retryTimeout = null;
      const url = getUserWsUrl();
      const ws = new WebSocket(url);
      activeSocket = ws;

      ws.onopen = () => {
        if (disposed || activeSocket !== ws) return;
        retries = 0;
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
          const message = JSON.parse(event.data as string) as {
            type?: string;
            workspaceId?: string;
            taskId?: string;
          };
          // New rows, and state changed elsewhere (another tab, a snooze
          // ending): the inbox pages, counts and the dropdown refetch.
          if (
            message.type === "NOTIFICATION_CREATED" ||
            message.type === "NOTIFICATIONS_UPDATED"
          ) {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          }
          if (message.type === "SUBSCRIPTION_UPDATED") {
            if (message.taskId) {
              queryClient.invalidateQueries({
                queryKey: ["task-subscription", message.taskId],
              });
            }
            // Subscribed views and "Your work" follow my subscriptions.
            void invalidateTaskQueries(queryClient);
          }
          if (message.type === "FAVORITES_UPDATED") {
            queryClient.invalidateQueries({
              queryKey: message.workspaceId
                ? ["favorites", message.workspaceId]
                : ["favorites"],
            });
          }
          // My drafts changed (here or in another tab): lists, the sidebar
          // count and an open draft refresh.
          if (message.type === "DRAFTS_UPDATED") {
            queryClient.invalidateQueries({
              queryKey: message.workspaceId
                ? taskDraftQueryKeys.workspace(message.workspaceId)
                : taskDraftQueryKeys.all(),
            });
          }
          // Stickies, quick links and Home widgets; this tab's own echo is
          // skipped.
          handleHomeUserMessage(queryClient, message, windowId);
          // My exports: the history refreshes; ready or failed ones toast.
          handleTaskExportUserMessage(queryClient, message);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (disposed || activeSocket !== ws) return;
        clearPing();
        activeSocket = null;

        if (retries < MAX_RETRIES) {
          const delay = BASE_DELAY * 2 ** retries;
          retries += 1;
          retryTimeout = setTimeout(connect, delay);
        }
      };
    }

    function dispose() {
      disposed = true;
      clearPing();
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      activeSocket?.close();
    }

    // Close before the session ends, so no reconnect races the sign-out.
    const stopOnSignOut = onSignOut(dispose);
    connect();

    return () => {
      stopOnSignOut();
      dispose();
    };
  }, [session?.user?.id, queryClient]);
}
