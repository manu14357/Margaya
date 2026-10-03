import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";

export type PageCommand = { value: string; label: string; onRun: () => void };

/**
 * The palette's "Create page": inside a project with Pages on, for people
 * who may create pages. It creates an untitled page and opens it.
 */
export function usePageCommands({
  workspaceId,
  projectId,
}: {
  workspaceId: string | undefined;
  projectId: string | undefined;
}): PageCommand[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createPage = useCreatePage();
  const { canCreatePages, isCheckingPermissions } = useWorkspacePermission();
  const { isEnabled } = useProjectFeatures({
    projectId: projectId ?? "",
    workspaceId: workspaceId ?? "",
  });
  const available =
    Boolean(workspaceId && projectId) &&
    !isCheckingPermissions &&
    canCreatePages() &&
    isEnabled("pages");
  const { mutate } = createPage;

  return useMemo(() => {
    if (!available || !workspaceId || !projectId) return [];
    return [
      {
        value: "create-page",
        label: t("pages:commandPalette.createPage"),
        onRun: () =>
          mutate(
            { projectId },
            {
              onSuccess: (page) =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, projectId, pageId: page.id },
                }),
              onError: (error) =>
                toast.error(
                  pageErrorMessage(error) ?? t("pages:toasts.createError"),
                ),
            },
          ),
      },
    ];
  }, [available, mutate, navigate, projectId, t, workspaceId]);
}
