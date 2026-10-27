import type { QueryClient } from "@tanstack/react-query";
import { agentKeys } from "@/hooks/queries/ai/use-agents";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

// User-socket hints for agents: a run changed (queued, running, finished,
// a change undone) or an approval was requested or decided. The Agent
// Desk, approval cards and the task's activity refetch.

export function handleAgentUserMessage(
  queryClient: QueryClient,
  message: { type?: string; workspaceId?: string; taskId?: string | null },
): void {
  if (
    message.type !== "AI_RUNS_UPDATED" &&
    message.type !== "AI_APPROVALS_UPDATED"
  ) {
    return;
  }
  if (message.workspaceId) {
    void queryClient.invalidateQueries({
      queryKey: agentKeys.runs(message.workspaceId),
    });
  }
  if (message.taskId) {
    void queryClient.invalidateQueries({
      queryKey: ["activities", message.taskId],
    });
    void queryClient.invalidateQueries({ queryKey: ["task", message.taskId] });
    void queryClient.invalidateQueries({
      queryKey: ["comments", message.taskId],
    });
    // Lists without a project socket (Your work, workspace views, the page
    // tree of other projects) show the agent's changes too; only mounted
    // queries refetch.
    void invalidateTaskQueries(queryClient);
    void queryClient.invalidateQueries({ queryKey: pageQueryKeys.lists() });
    void queryClient.invalidateQueries({
      queryKey: pageQueryKeys.taskReferences(),
    });
  }
}
