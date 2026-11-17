import { type QueryClient, useQuery } from "@tanstack/react-query";
import {
  getProjectTemplate,
  getProjectTemplates,
  getWorkspaceStarters,
} from "@/fetchers/project-template/project-templates";
import { useLocale } from "@/hooks/use-locale";
import { projectTemplateQueryKeys } from "./project-template-query-keys";

const catalogQuery = (locale: string) => ({
  queryKey: projectTemplateQueryKeys.catalog(locale),
  queryFn: () => getProjectTemplates(locale),
  staleTime: Number.POSITIVE_INFINITY,
});

/** The template gallery in the active language. */
export function useProjectTemplates({ enabled = true } = {}) {
  const { locale } = useLocale();
  return useQuery({ ...catalogQuery(locale), enabled });
}

/** What one template creates, fetched when its card is selected. */
export function useProjectTemplate(id: string | null | undefined) {
  const { locale } = useLocale();
  return useQuery({
    queryKey: projectTemplateQueryKeys.preview(id ?? "", locale),
    queryFn: () => getProjectTemplate(id ?? "", locale),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: Boolean(id),
  });
}

/** Sets of projects a brand-new workspace can start with. */
export function useWorkspaceStarters({ enabled = true } = {}) {
  const { locale } = useLocale();
  return useQuery({
    queryKey: projectTemplateQueryKeys.starters(locale),
    queryFn: () => getWorkspaceStarters(locale),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

/** Warms the catalog when an entry point gets hover or focus. */
export function prefetchProjectTemplates(
  queryClient: QueryClient,
  locale: string,
) {
  return queryClient.prefetchQuery(catalogQuery(locale));
}
