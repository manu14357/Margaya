import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/components/settings-layout";
import ProjectTrashView from "@/components/trash/project-trash-view";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/trash",
)({
  component: RouteComponent,
});

/** Settings → Workspace → Recently deleted projects (C7). */
function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, canDeleteProjects, isCheckingPermissions } =
    useWorkspacePermission();

  return (
    <SettingsPage
      title={t("settings:trash.workspaceTitle")}
      description={t("settings:trash.workspaceSubtitle")}
    >
      {workspace?.id && (
        <ProjectTrashView
          workspaceId={workspace.id}
          canDelete={!isCheckingPermissions && canDeleteProjects()}
        />
      )}
    </SettingsPage>
  );
}
