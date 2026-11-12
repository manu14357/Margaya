import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getLatestProjectUpdates,
  getProjectUpdate,
  getProjectUpdateFollow,
  getProjectUpdateReminder,
  listProjectUpdates,
} from "@/fetchers/project-update/project-update";

// Project status updates. Every key starts with "project-updates", so one
// prefix invalidation (a mutation, or the project socket's
// PROJECT_UPDATES_CHANGED hint) refreshes the whole feature.

export const projectUpdateKeys = {
  all: ["project-updates"] as const,
  project: (projectId: string) => ["project-updates", projectId] as const,
  list: (projectId: string) => ["project-updates", projectId, "list"] as const,
  detail: (projectId: string, id: string) =>
    ["project-updates", projectId, "detail", id] as const,
  follow: (projectId: string) =>
    ["project-updates", projectId, "follow"] as const,
  reminder: (projectId: string) =>
    ["project-updates", projectId, "reminder"] as const,
  latest: (workspaceId: string) =>
    ["project-updates", "latest", workspaceId] as const,
};

export function useProjectUpdates(projectId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: projectUpdateKeys.list(projectId),
    queryFn: ({ pageParam }) => listProjectUpdates(projectId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && Boolean(projectId),
  });
}

export function useProjectUpdate(
  projectId: string,
  id: string,
  enabled = true,
) {
  return useQuery({
    queryKey: projectUpdateKeys.detail(projectId, id),
    queryFn: () => getProjectUpdate(id),
    enabled: enabled && Boolean(id),
  });
}

export function useProjectUpdateFollow(projectId: string, enabled = true) {
  return useQuery({
    queryKey: projectUpdateKeys.follow(projectId),
    queryFn: () => getProjectUpdateFollow(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

export function useProjectUpdateReminder(projectId: string, enabled = true) {
  return useQuery({
    queryKey: projectUpdateKeys.reminder(projectId),
    queryFn: () => getProjectUpdateReminder(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

export function useLatestProjectUpdates(workspaceId: string) {
  return useQuery({
    queryKey: projectUpdateKeys.latest(workspaceId),
    queryFn: () => getLatestProjectUpdates(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}
