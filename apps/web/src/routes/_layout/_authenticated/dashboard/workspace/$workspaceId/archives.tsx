import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ArchivesView from "@/components/archives/archives-view";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { type ArchiveTab, isArchiveTab } from "@/lib/archives";

type ArchivesSearchParams = {
  tab?: ArchiveTab;
  projectId?: string;
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/archives",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): ArchivesSearchParams => ({
    tab: isArchiveTab(search.tab) ? search.tab : undefined,
    projectId:
      typeof search.projectId === "string" && search.projectId
        ? search.projectId
        : undefined,
    taskId:
      typeof search.taskId === "string" && search.taskId
        ? search.taskId
        : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId } = Route.useParams();
  const { tab, projectId, taskId } = Route.useSearch();

  return (
    <>
      <PageTitle title={t("workspace:archives.pageTitle")} />
      <WorkspaceLayout title={t("workspace:archives.title")}>
        <ArchivesView
          workspaceId={workspaceId}
          tab={tab ?? "tasks"}
          filterProjectId={projectId}
          taskId={taskId}
          onSearchChange={(patch) =>
            navigate({
              to: ".",
              search: (previous: Record<string, unknown>) => ({
                ...previous,
                ...patch,
              }),
              replace: true,
            })
          }
        />
      </WorkspaceLayout>
    </>
  );
}
