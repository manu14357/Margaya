import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentRunStatus,
  getAgentApprovals,
  getAgentRun,
  getAgentRuns,
  getAgents,
  getAgentTemplates,
} from "@/fetchers/ai/agents";

export const agentKeys = {
  all: ["ai-agents"] as const,
  list: (workspaceId: string) => ["ai-agents", "list", workspaceId] as const,
  runs: (workspaceId: string) => ["ai-runs", workspaceId] as const,
  runList: (
    workspaceId: string,
    filter: { agentId?: string; taskId?: string; status?: AgentRunStatus },
  ) => ["ai-runs", workspaceId, "list", filter] as const,
  run: (workspaceId: string, runId: string) =>
    ["ai-runs", workspaceId, "run", runId] as const,
  approvals: (workspaceId: string) =>
    ["ai-runs", workspaceId, "approvals"] as const,
  templates: (workspaceId: string) =>
    ["ai-agents", "templates", workspaceId] as const,
};

/** Ready-made agents (static on the server: cached for the session). */
export function useAgentTemplates(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: agentKeys.templates(workspaceId),
    queryFn: () => getAgentTemplates(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * The workspace's agents. Cheap and long-cached: every member reads it to
 * mark agents and keep them out of human-only pickers.
 */
export function useAgents(workspaceId: string | undefined) {
  return useQuery({
    queryKey: agentKeys.list(workspaceId ?? ""),
    queryFn: () => getAgents(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });
}

/** The user ids of the workspace's agents (a stable empty set at first). */
export function useAgentUserIds(workspaceId: string | undefined) {
  const { data } = useAgents(workspaceId);
  return useMemo(
    () => new Set((data ?? []).map((agent) => agent.userId)),
    [data],
  );
}

export function useAgentRuns(
  workspaceId: string,
  filter: { agentId?: string; taskId?: string; status?: AgentRunStatus } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: agentKeys.runList(workspaceId, filter),
    queryFn: () => getAgentRuns({ workspaceId, ...filter }),
    enabled: Boolean(workspaceId) && enabled,
    // Running work refreshes through the user socket; poll gently as well
    // while something is still in flight.
    refetchInterval: (query) =>
      query.state.data?.some(
        (run) => run.status === "queued" || run.status === "running",
      )
        ? 5_000
        : false,
  });
}

export function useAgentRun(workspaceId: string, runId: string | null) {
  return useQuery({
    queryKey: agentKeys.run(workspaceId, runId ?? ""),
    queryFn: () => getAgentRun(workspaceId, runId ?? ""),
    enabled: Boolean(workspaceId && runId),
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "running"
        ? 3_000
        : false,
  });
}

export function useAgentApprovals(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: agentKeys.approvals(workspaceId),
    queryFn: () => getAgentApprovals(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
  });
}
