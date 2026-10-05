import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ArchivesView from "@/components/archives/archives-view";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { type ArchiveTab, isArchiveTab } from "@/lib/archives";

type ProjectArchivesSearchParams = {
  tab?: Exclude<ArchiveTab, "projects">;
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/archives",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): ProjectArchivesSearchParams => ({
    tab:
      isArchiveTab(search.tab) && search.tab !== "projects"
        ? search.tab
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
  const { workspaceId, projectId } = Route.useParams();
  const { tab, taskId } = Route.useSearch();

  return (
    <>
      <PageTitle title={t("workspace:archives.pageTitle")} />
      <ProjectLayout
        projectId={projectId}
        workspaceId={workspaceId}
        activeSection="tasks"
        showViewSwitcher={false}
        extraCrumbs={
          <span className="text-foreground text-xs">
            {t("workspace:archives.title")}
          </span>
        }
      >
        <ArchivesView
          workspaceId={workspaceId}
          projectId={projectId}
          tab={tab ?? "tasks"}
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
      </ProjectLayout>
    </>
  );
}
