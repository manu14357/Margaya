import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deletePageTemplate,
  savePageAsTemplate,
} from "@/fetchers/page/page-templates";
import { pageTemplateKeys } from "@/hooks/queries/page/use-page-templates";

/** Saves a page as a template; workspace ones show in every project. */
export function useSavePageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      ...json
    }: {
      pageId: string;
      name: string;
      scope: "project" | "workspace";
    }) => savePageAsTemplate(pageId, json),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: pageTemplateKeys.all() }),
  });
}

export function useDeletePageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => deletePageTemplate(templateId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: pageTemplateKeys.all() }),
  });
}
