import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateAiConnectorInput,
  createAiConnector,
  deleteAiConnector,
  testAiConnector,
  type UpdateAiConnectorInput,
  updateAiConnector,
} from "@/fetchers/ai/connectors";
import { connectorKeys } from "@/hooks/queries/ai/use-connectors";

function useInvalidate() {
  const queryClient = useQueryClient();
  return (workspaceId: string) =>
    queryClient.invalidateQueries({
      queryKey: connectorKeys.list(workspaceId),
    });
}

export function useCreateAiConnector() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateAiConnectorInput) => createAiConnector(input),
    onSuccess: (_row, input) => invalidate(input.workspaceId),
  });
}

export function useUpdateAiConnector() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      connectorId: string;
      patch: UpdateAiConnectorInput;
    }) => updateAiConnector(input.connectorId, input.patch),
    onSuccess: (_row, input) => invalidate(input.patch.workspaceId),
  });
}

export function useDeleteAiConnector() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { workspaceId: string; connectorId: string }) =>
      deleteAiConnector(input.workspaceId, input.connectorId),
    onSuccess: (_row, input) => invalidate(input.workspaceId),
  });
}

/** Connects and lists the server's tools; nothing is cached. */
export function useTestAiConnector() {
  return useMutation({
    mutationFn: (input: { workspaceId: string; connectorId: string }) =>
      testAiConnector(input.workspaceId, input.connectorId),
  });
}
