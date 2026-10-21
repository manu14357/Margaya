import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCodingAgentProfile,
  deleteCodingAgentProfile,
  getCodingAgentProfiles,
  getTaskCodingAgents,
  prepareCodingAgentBrief,
  sendToCodingAgent,
  updateCodingAgentProfile,
} from "@/fetchers/coding-agent/coding-agent";

export const codingAgentKeys = {
  profiles: (workspaceId: string) =>
    ["coding-agent", "profiles", workspaceId] as const,
  // The WebSocket hint (CODING_HANDOFF_UPDATED) invalidates this key.
  task: (taskId: string) => ["coding-agent", "task", taskId] as const,
};

/** Handoffs, repositories and enabled profiles of a task. */
export function useTaskCodingAgents(taskId: string | undefined) {
  return useQuery({
    queryKey: codingAgentKeys.task(taskId ?? ""),
    queryFn: () => getTaskCodingAgents(taskId ?? ""),
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });
}

export function useCodingAgentProfiles(workspaceId: string) {
  return useQuery({
    queryKey: codingAgentKeys.profiles(workspaceId),
    queryFn: () => getCodingAgentProfiles(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

/** Builds the brief for review; nothing is sent. */
export function usePrepareCodingAgentBrief() {
  return useMutation({ mutationFn: prepareCodingAgentBrief });
}

export function useSendToCodingAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendToCodingAgent,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: codingAgentKeys.task(input.taskId),
      });
    },
  });
}

function useProfileMutation<TInput extends { workspaceId: string }, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: codingAgentKeys.profiles(input.workspaceId),
      });
      // Task panels list the enabled profiles.
      void queryClient.invalidateQueries({
        queryKey: ["coding-agent", "task"],
      });
    },
  });
}

export function useCreateCodingAgentProfile() {
  return useProfileMutation(createCodingAgentProfile);
}

export function useUpdateCodingAgentProfile() {
  return useProfileMutation(updateCodingAgentProfile);
}

export function useDeleteCodingAgentProfile() {
  return useProfileMutation(deleteCodingAgentProfile);
}
