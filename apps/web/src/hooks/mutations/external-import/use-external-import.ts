import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ExternalImportSource,
  importExternalItems,
  previewExternalImport,
} from "@/fetchers/external-import/external-import";

/** Reads the uploaded export: counts, statuses and people. */
export function usePreviewExternalImport() {
  return useMutation({
    mutationFn: ({
      source,
      projectId,
      content,
    }: {
      source: ExternalImportSource;
      projectId: string;
      content: string;
    }) => previewExternalImport(source, projectId, content),
  });
}

/**
 * Runs the import. The board and labels refresh once at the end, also after
 * a failure: some items may already be in.
 */
export function useImportExternalItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importExternalItems,
    onSettled: (_data, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}
