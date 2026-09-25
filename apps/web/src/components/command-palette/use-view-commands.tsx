import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ViewFormDialog from "@/components/view/view-form-dialog";
import { useGetViews } from "@/hooks/queries/view/use-get-views";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { viewPath } from "@/lib/view/entity-link";

export type ViewCommand = {
  value: string;
  label: string;
  onRun: () => void;
};

type Options = {
  workspaceId: string | undefined;
  /** The project the palette was opened in, if any. */
  projectId: string | undefined;
  /** Views load only while the palette is open. */
  open: boolean;
};

/**
 * The palette's saved-view commands: open any view in reach (the current
 * project's, when its views are on, and the workspace's) and "New view",
 * which creates one in the current project or else in the workspace.
 */
export function useViewCommands({ workspaceId, projectId, open }: Options) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { canCreateViews, isCheckingPermissions } = useWorkspacePermission();
  const { isEnabled } = useProjectFeatures({
    projectId: projectId ?? "",
    workspaceId: workspaceId ?? "",
  });
  const projectViewsOn = Boolean(projectId) && isEnabled("views");
  const canCreate = !isCheckingPermissions && canCreateViews();

  const { data: projectViews } = useGetViews({
    workspaceId: workspaceId ?? "",
    projectId: projectId ?? null,
    enabled: open && projectViewsOn,
  });
  const { data: workspaceViews } = useGetViews({
    workspaceId: workspaceId ?? "",
    projectId: null,
    enabled: open,
  });

  const items = useMemo<ViewCommand[]>(() => {
    if (!workspaceId) return [];
    const views = [
      ...(projectViewsOn ? (projectViews ?? []) : []),
      ...(workspaceViews ?? []),
    ];
    const commands: ViewCommand[] = views.map((view) => ({
      value: `view:${view.id}`,
      label: view.name,
      onRun: () =>
        navigate({ to: viewPath(workspaceId, view.id, view.projectId) }),
    }));
    if (canCreate) {
      commands.push({
        value: "new-view",
        label: t("navigation:commandPalette.newView"),
        onRun: () => setIsCreateOpen(true),
      });
    }
    return commands;
  }, [
    workspaceId,
    projectViewsOn,
    projectViews,
    workspaceViews,
    canCreate,
    navigate,
    t,
  ]);

  const dialog: ReactNode =
    canCreate && workspaceId ? (
      <ViewFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        workspaceId={workspaceId}
        projectId={projectViewsOn ? (projectId ?? null) : null}
        onSaved={(view) =>
          navigate({ to: viewPath(view.workspaceId, view.id, view.projectId) })
        }
      />
    ) : null;

  return { items, label: t("views:nav.title"), dialog };
}
