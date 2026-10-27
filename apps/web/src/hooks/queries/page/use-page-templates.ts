import { useQuery } from "@tanstack/react-query";
import { listPageTemplates } from "@/fetchers/page/page-templates";

export const pageTemplateKeys = {
  all: () => ["page-templates"] as const,
  list: (projectId: string) => ["page-templates", projectId] as const,
};

/** Saved templates offered when creating a page in the project. */
export function usePageTemplates(projectId: string, enabled = true) {
  return useQuery({
    queryKey: pageTemplateKeys.list(projectId),
    queryFn: () => listPageTemplates(projectId),
    enabled: enabled && Boolean(projectId),
    staleTime: 30_000,
  });
}
