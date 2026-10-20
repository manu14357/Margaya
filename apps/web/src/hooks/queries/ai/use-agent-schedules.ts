import { useQuery } from "@tanstack/react-query";
import { getAgentSchedules } from "@/fetchers/ai/agent-schedules";

export const agentScheduleKeys = {
  list: (workspaceId: string, agentId: string) =>
    ["ai-agents", "schedules", workspaceId, agentId] as const,
};

export function useAgentSchedules(workspaceId: string, agentId: string | null) {
  return useQuery({
    queryKey: agentScheduleKeys.list(workspaceId, agentId ?? ""),
    queryFn: () => getAgentSchedules(workspaceId, agentId ?? ""),
    enabled: Boolean(workspaceId && agentId),
  });
}
