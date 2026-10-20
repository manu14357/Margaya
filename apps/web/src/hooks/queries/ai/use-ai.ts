import { useQuery } from "@tanstack/react-query";
import {
  getAiAvailability,
  getAiSettings,
  getAiUsage,
  getInstanceAiStatus,
  getInstanceAiUsage,
} from "@/fetchers/ai/ai";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const aiKeys = {
  all: ["ai"] as const,
  availability: (workspaceId: string, projectId: string | null) =>
    ["ai", "availability", workspaceId, projectId] as const,
  settings: (workspaceId: string) => ["ai", "settings", workspaceId] as const,
  usage: (workspaceId: string, from: string, to: string) =>
    ["ai", "usage", workspaceId, from, to] as const,
  instanceStatus: () => ["ai", "instance", "status"] as const,
  instanceUsage: (from: string, to: string) =>
    ["ai", "instance", "usage", from, to] as const,
  skills: (workspaceId: string) => ["ai", "skills", workspaceId] as const,
  memory: (workspaceId: string) => ["ai", "memory", workspaceId] as const,
  conversations: (workspaceId: string) =>
    ["ai", "conversations", workspaceId] as const,
  conversation: (workspaceId: string, id: string) =>
    ["ai", "conversations", workspaceId, id] as const,
};

/**
 * Whether to show AI features here. `available` is true only when AI is on
 * for the instance, the workspace and (with `projectId`) the project, a
 * provider is set up, and the person has ai:use. While loading, or on any
 * error, it reads as unavailable, so AI UI stays hidden rather than flashing.
 *
 *   const { available } = useAiAvailability(projectId);
 *   if (!available) return null;
 */
export function useAiAvailability(projectId?: string | null) {
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const query = useQuery({
    queryKey: aiKeys.availability(workspaceId, projectId ?? null),
    queryFn: () => getAiAvailability(workspaceId, projectId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
  });
  return {
    ...query,
    available: query.data?.available === true,
    canUse: query.data?.canUse === true,
    canManage: query.data?.canManage === true,
  };
}

export function useAiSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.settings(workspaceId),
    queryFn: () => getAiSettings(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useAiUsage(input: {
  workspaceId: string;
  from: string;
  to: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: aiKeys.usage(input.workspaceId, input.from, input.to),
    queryFn: () =>
      getAiUsage({
        workspaceId: input.workspaceId,
        from: input.from,
        to: input.to,
      }),
    enabled: Boolean(input.workspaceId) && input.enabled !== false,
  });
}

export function useInstanceAiStatus() {
  return useQuery({
    queryKey: aiKeys.instanceStatus(),
    queryFn: getInstanceAiStatus,
    refetchOnWindowFocus: true,
  });
}

export function useInstanceAiUsage(from: string, to: string) {
  return useQuery({
    queryKey: aiKeys.instanceUsage(from, to),
    queryFn: () => getInstanceAiUsage({ from, to }),
  });
}
