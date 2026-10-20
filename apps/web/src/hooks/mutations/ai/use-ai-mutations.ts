import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AiSettingsPatch,
  testAiConnection,
  testInstanceAiConnection,
  updateAiSettings,
} from "@/fetchers/ai/ai";
import { aiKeys } from "@/hooks/queries/ai/use-ai";

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsPatch) => updateAiSettings(patch),
    onSuccess: (settings, patch) => {
      queryClient.setQueryData(aiKeys.settings(patch.workspaceId), settings);
      // Every AI affordance reads availability; refresh it everywhere.
      void queryClient.invalidateQueries({
        queryKey: ["ai", "availability", patch.workspaceId],
      });
    },
  });
}

export function useTestAiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => testAiConnection(workspaceId),
    onSettled: (_result, _error, workspaceId) => {
      void queryClient.invalidateQueries({
        queryKey: ["ai", "usage", workspaceId],
      });
    },
  });
}

export function useTestInstanceAiConnection() {
  return useMutation({
    mutationFn: (target: "cloud" | "local") => testInstanceAiConnection(target),
  });
}
