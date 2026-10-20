import { useQuery } from "@tanstack/react-query";
import { getAiConnectors } from "@/fetchers/ai/connectors";

export const connectorKeys = {
  list: (workspaceId: string) => ["ai-connectors", workspaceId] as const,
};

export function useAiConnectors(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: connectorKeys.list(workspaceId),
    queryFn: () => getAiConnectors(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
  });
}
