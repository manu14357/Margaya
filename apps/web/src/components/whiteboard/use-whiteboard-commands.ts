import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCreateWhiteboard } from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import { showWhiteboardsDestination } from "@/lib/whiteboards/workspace-whiteboards";

export type WhiteboardCommand = {
  value: string;
  label: string;
  onRun: () => void;
};

/**
 * The palette's whiteboard entries. Anywhere in a workspace with boards:
 * "Go to all whiteboards" (the workspace list, for whoever the rail offers
 * it to). Inside a project with Whiteboards on: "Go to whiteboards" for
 * people who can see boards, and "New whiteboard" (a blank board, opened at
 * once) for people who may create them.
 */
export function useWhiteboardCommands({
  workspaceId,
  projectId,
}: {
  workspaceId: string | undefined;
  projectId: string | undefined;
}): WhiteboardCommand[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mutate } = useCreateWhiteboard();
  const {
    canReadWhiteboards,
    canCreateWhiteboards,
    isCheckingPermissions,
    isGuest,
  } = useWorkspacePermission();
  const { data: projects } = useGetProjects({ workspaceId: workspaceId ?? "" });
  const canSeeAll =
    Boolean(workspaceId) &&
    showWhiteboardsDestination({
      isGuest,
      isCheckingPermissions,
      canRead: canReadWhiteboards(),
      projects,
    });
  const { isEnabled } = useProjectFeatures({
    projectId: projectId ?? "",
    workspaceId: workspaceId ?? "",
  });
  const inProject =
    Boolean(workspaceId && projectId) &&
    !isCheckingPermissions &&
    isEnabled("whiteboards");
  const canRead = inProject && canReadWhiteboards();
  const canCreate = inProject && canCreateWhiteboards();

  return useMemo(() => {
    if (!workspaceId) return [];
    const commands: WhiteboardCommand[] = [];
    if (canSeeAll) {
      commands.push({
        value: "all-whiteboards",
        label: t("whiteboards:commandPalette.goToAllWhiteboards"),
        onRun: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/whiteboards",
            params: { workspaceId },
          }),
      });
    }
    if (!projectId) return commands;
    if (canRead) {
      commands.push({
        value: "whiteboards",
        label: t("whiteboards:commandPalette.goToWhiteboards"),
        onRun: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards",
            params: { workspaceId, projectId },
          }),
      });
    }
    if (canCreate) {
      commands.push({
        value: "create-whiteboard",
        label: t("whiteboards:commandPalette.newWhiteboard"),
        onRun: () =>
          mutate(
            { projectId },
            {
              onSuccess: (board) =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
                  params: { workspaceId, projectId, whiteboardId: board.id },
                }),
              onError: (error) =>
                toast.error(
                  pageErrorMessage(error) ??
                    t("whiteboards:toasts.createError"),
                ),
            },
          ),
      });
    }
    return commands;
  }, [
    canCreate,
    canRead,
    canSeeAll,
    mutate,
    navigate,
    projectId,
    t,
    workspaceId,
  ]);
}
