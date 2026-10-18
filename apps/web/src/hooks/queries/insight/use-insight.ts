import { useQuery } from "@tanstack/react-query";
import {
  getCycleCapacity,
  getEstimateCalibration,
  getEstimateSuggestion,
  getMyBrief,
  getRetroFacts,
} from "@/fetchers/insight/insight";

// Planning insights are computed on the server per request. Cycle-scoped
// ones live under the ["cycles", projectId] prefix, so cycle membership and
// task changes refresh them with the rest of the cycle.

export const insightKeys = {
  suggestion: (projectId: string, taskId: string) =>
    ["insight", "estimate-suggestion", projectId, taskId] as const,
  calibration: (projectId: string) =>
    ["insight", "estimate-calibration", projectId] as const,
  capacity: (projectId: string, cycleId: string) =>
    ["cycles", projectId, "capacity", cycleId] as const,
  retro: (projectId: string, cycleId: string) =>
    ["cycles", projectId, "retro", cycleId] as const,
  myBrief: (workspaceId: string) =>
    ["insight", "my-brief", workspaceId] as const,
};

const MINUTE = 60_000;

export function useEstimateSuggestion(
  projectId: string,
  taskId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: insightKeys.suggestion(projectId, taskId),
    queryFn: ({ signal }) => getEstimateSuggestion(projectId, taskId, signal),
    enabled: enabled && Boolean(projectId && taskId),
    staleTime: 5 * MINUTE,
    retry: false,
  });
}

export function useEstimateCalibration(projectId: string, enabled = true) {
  return useQuery({
    queryKey: insightKeys.calibration(projectId),
    queryFn: ({ signal }) => getEstimateCalibration(projectId, signal),
    enabled: enabled && Boolean(projectId),
    staleTime: 5 * MINUTE,
  });
}

export function useCycleCapacity(
  projectId: string,
  cycleId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: insightKeys.capacity(projectId, cycleId),
    queryFn: ({ signal }) => getCycleCapacity(cycleId, signal),
    enabled: enabled && Boolean(projectId && cycleId),
    staleTime: MINUTE,
  });
}

export function useRetroFacts(
  projectId: string,
  cycleId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: insightKeys.retro(projectId, cycleId),
    queryFn: ({ signal }) => getRetroFacts(cycleId, signal),
    enabled: enabled && Boolean(projectId && cycleId),
    staleTime: MINUTE,
  });
}

export function useMyBrief(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: insightKeys.myBrief(workspaceId),
    queryFn: ({ signal }) => getMyBrief(workspaceId, signal),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 5 * MINUTE,
  });
}
