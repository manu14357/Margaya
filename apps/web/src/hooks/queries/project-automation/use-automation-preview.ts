import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import previewProjectAutomation from "@/fetchers/project-automation/preview-project-automation";
import type { AutomationRule } from "@/types/project-automation";
import { projectAutomationQueryKeys } from "./project-automation-query-keys";

const PREVIEW_STALE_TIME = 30_000;

/** The matching task count of a rule that is on, for its preview line. */
export function useAutomationPreview({
  workspaceId,
  projectId,
  rule,
  months,
  enabled,
}: {
  workspaceId: string;
  projectId: string;
  rule: AutomationRule;
  months: number;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: projectAutomationQueryKeys.preview(
      workspaceId,
      projectId,
      rule,
      months,
    ),
    queryFn: () => previewProjectAutomation(projectId, rule, months),
    enabled: Boolean(workspaceId && projectId) && enabled,
    staleTime: PREVIEW_STALE_TIME,
    retry: false,
  });
}

/** Reads a preview once, before a change that may need confirmation. */
export function useFetchAutomationPreview(
  workspaceId: string,
  projectId: string,
) {
  const queryClient = useQueryClient();
  return useCallback(
    (rule: AutomationRule, months: number) =>
      queryClient.fetchQuery({
        queryKey: projectAutomationQueryKeys.preview(
          workspaceId,
          projectId,
          rule,
          months,
        ),
        queryFn: () => previewProjectAutomation(projectId, rule, months),
        staleTime: PREVIEW_STALE_TIME,
      }),
    [queryClient, workspaceId, projectId],
  );
}
