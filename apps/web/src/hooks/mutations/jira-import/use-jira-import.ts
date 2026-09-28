import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  importJiraIssues,
  previewJiraImport,
} from "@/fetchers/jira-import/jira-import";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/** Reads the uploaded export: counts, columns, statuses and people. */
export function usePreviewJiraImport() {
  return useMutation({
    mutationFn: ({
      projectId,
      content,
    }: {
      projectId: string;
      content: string;
    }) => previewJiraImport(projectId, content),
  });
}

/**
 * Runs the import. The board, labels, cycles and modules refresh once at the
 * end, also after a failure: some issues may already be in.
 */
export function useImportJiraIssues() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importJiraIssues,
    onSettled: (_data, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
      void queryClient.invalidateQueries({
        queryKey: cycleQueryKeys.all(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: moduleQueryKeys.all(projectId),
      });
    },
  });
}
