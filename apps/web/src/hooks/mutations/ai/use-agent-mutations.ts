import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type SetAgentIntakeTriggerInput,
  setAgentIntakeTrigger,
} from "@/fetchers/ai/agent-intake-trigger";
import {
  type CreateAgentInput,
  cancelAgentRun,
  createAgent,
  decideAgentApproval,
  deleteAgent,
  followUpAgentRun,
  replyToAgentRun,
  startAgentRun,
  type UpdateAgentInput,
  undoAgentChange,
  updateAgent,
} from "@/fetchers/ai/agents";
import { agentKeys } from "@/hooks/queries/ai/use-agents";

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => {
    void queryClient.invalidateQueries({
      queryKey: agentKeys.list(workspaceId),
    });
    // Agents are workspace members: member lists and pickers refresh.
    void queryClient.invalidateQueries({ queryKey: ["workspace-users"] });
    void queryClient.invalidateQueries({
      queryKey: ["active-workspace-users"],
    });
  };
}

export function useCreateAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => createAgent(input),
    onSuccess: (_agent, input) => invalidate(input.workspaceId),
  });
}

export function useUpdateAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (input: { agentId: string; patch: UpdateAgentInput }) =>
      updateAgent(input.agentId, input.patch),
    onSuccess: (_agent, input) => invalidate(input.patch.workspaceId),
  });
}

/** Turns an agent's intake trigger on or off and sets its prompt. */
export function useSetAgentIntakeTrigger() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (input: {
      agentId: string;
      trigger: SetAgentIntakeTriggerInput;
    }) => setAgentIntakeTrigger(input.agentId, input.trigger),
    onSuccess: (_agent, input) => invalidate(input.trigger.workspaceId),
    meta: { refreshTaskQueries: false },
  });
}

export function useDeleteAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (input: { workspaceId: string; agentId: string }) =>
      deleteAgent(input.workspaceId, input.agentId),
    onSuccess: (_result, input) => invalidate(input.workspaceId),
  });
}

/** Runs, approvals and the task's activity change together. */
function useInvalidateRuns() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => {
    void queryClient.invalidateQueries({
      queryKey: agentKeys.runs(workspaceId),
    });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
    void queryClient.invalidateQueries({ queryKey: ["comments"] });
    void queryClient.invalidateQueries({ queryKey: ["task"] });
  };
}

export function useStartAgentRun() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: startAgentRun,
    onSuccess: (_run, input) => invalidate(input.workspaceId),
  });
}

export function useCancelAgentRun() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: (input: { workspaceId: string; runId: string }) =>
      cancelAgentRun(input.workspaceId, input.runId),
    onSuccess: (_run, input) => invalidate(input.workspaceId),
  });
}

export function useUndoAgentChange() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: (input: { workspaceId: string; stepId: string }) =>
      undoAgentChange(input.workspaceId, input.stepId),
    onSuccess: (_result, input) => invalidate(input.workspaceId),
  });
}

export function useDecideAgentApproval() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: decideAgentApproval,
    onSuccess: (_result, input) => invalidate(input.workspaceId),
  });
}

export function useReplyToAgentRun() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: replyToAgentRun,
    onSuccess: (_run, input) => invalidate(input.workspaceId),
  });
}

export function useFollowUpAgentRun() {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: followUpAgentRun,
    onSuccess: (_run, input) => invalidate(input.workspaceId),
  });
}
