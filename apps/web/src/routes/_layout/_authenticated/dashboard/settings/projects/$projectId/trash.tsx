import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";
import PageTrashView from "@/components/trash/page-trash-view";
import TaskTrashView from "@/components/trash/task-trash-view";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/trash",
)({
  component: RouteComponent,
});

/** Settings → Project → Recently deleted: its tasks and pages (C7). */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const { data: project } = useGetProject({
    id: projectId,
    workspaceId: workspace?.id ?? "",
  });
  const { canDeleteTasks, isCheckingPermissions } = useWorkspacePermission();
  const pageTitle = t("settings:trash.projectTitle");

  return (
    <SettingsPage
      title={pageTitle}
      documentTitle={
        project?.name ? `${pageTitle} · ${project.name}` : pageTitle
      }
      description={t("settings:trash.projectSubtitle")}
    >
      <SettingsSection title={t("settings:trash.tasksHeading")}>
        <TaskTrashView
          projectId={projectId}
          canDelete={!isCheckingPermissions && canDeleteTasks()}
        />
      </SettingsSection>
      {project?.pagesEnabled && (
        <SettingsSection title={t("settings:trash.pagesHeading")}>
          <PageTrashView projectId={projectId} />
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
