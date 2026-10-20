import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateAgentScheduleInput,
  createAgentSchedule,
  deleteAgentSchedule,
  type UpdateAgentScheduleInput,
  updateAgentSchedule,
} from "@/fetchers/ai/agent-schedules";
import { agentScheduleKeys } from "@/hooks/queries/ai/use-agent-schedules";

function useInvalidate() {
  const queryClient = useQueryClient();
  return (workspaceId: string, agentId: string) =>
    queryClient.invalidateQueries({
      queryKey: agentScheduleKeys.list(workspaceId, agentId),
    });
}

export function useCreateAgentSchedule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      agentId: string;
      schedule: CreateAgentScheduleInput;
    }) => createAgentSchedule(input.agentId, input.schedule),
    onSuccess: (_row, input) =>
      invalidate(input.schedule.workspaceId, input.agentId),
  });
}

export function useUpdateAgentSchedule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      agentId: string;
      scheduleId: string;
      patch: UpdateAgentScheduleInput;
    }) => updateAgentSchedule(input.agentId, input.scheduleId, input.patch),
    onSuccess: (_row, input) =>
      invalidate(input.patch.workspaceId, input.agentId),
  });
}

export function useDeleteAgentSchedule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      workspaceId: string;
      agentId: string;
      scheduleId: string;
    }) =>
      deleteAgentSchedule(input.workspaceId, input.agentId, input.scheduleId),
    onSuccess: (_row, input) => invalidate(input.workspaceId, input.agentId),
  });
}
