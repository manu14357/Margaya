import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTriageSettings,
  suggestTriage,
  updateTriageSettings,
} from "@/fetchers/ai/triage";

export const triageKeys = {
  settings: (projectId: string) =>
    ["ai", "triage", "settings", projectId] as const,
};

/** Asks for suggestions on demand; nothing is applied by asking. */
export function useSuggestTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: suggestTriage,
    onSuccess: (result) => {
      // Auto-applied labels (a project opt-in) changed the task.
      if (!result.autoApplied) return;
      void queryClient.invalidateQueries({
        queryKey: ["labels", result.taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["task", result.taskId] });
      void queryClient.invalidateQueries({
        queryKey: ["activities", result.taskId],
      });
    },
  });
}

export function useTriageSettings(projectId: string, enabled = true) {
  return useQuery({
    queryKey: triageKeys.settings(projectId),
    queryFn: () => getTriageSettings(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useUpdateTriageSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTriageSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(
        triageKeys.settings(settings.projectId),
        settings,
      );
    },
  });
}
