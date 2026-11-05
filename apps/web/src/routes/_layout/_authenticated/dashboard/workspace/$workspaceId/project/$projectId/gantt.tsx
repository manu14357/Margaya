import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import ProjectGantt from "@/components/gantt/project-gantt";
import PageTitle from "@/components/page-title";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import ProjectFilterBar from "@/components/task-filters/project-filter-bar";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useLoadFailure } from "@/hooks/use-load-failure";
import { useProjectLayoutFilter } from "@/hooks/use-project-layout-filter";

type GanttSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): GanttSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId } = Route.useSearch();
  const navigate = useNavigate();
  const tasksQuery = useGetTasks(projectId);
  const { data: loadedProject, isLoading } = tasksQuery;
  const loadFailure = useLoadFailure(tasksQuery);
  const {
    queryState,
    filteredProject: project,
    status: filterStatus,
  } = useProjectLayoutFilter({
    workspaceId,
    projectId,
    project: loadedProject,
  });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="gantt"
    >
      <PageTitle
        title={t("tasks:gantt.pageTitle", { name: project?.name })}
        hideAppName
      />
      <ProjectGantt
        workspaceId={workspaceId}
        projectId={projectId}
        loadedProject={loadedProject}
        project={project}
        isLoading={isLoading}
        loadFailure={loadFailure}
        filterBar={
          <ProjectFilterBar
            workspaceId={workspaceId}
            projectId={projectId}
            handle={queryState}
            status={filterStatus}
          />
        }
        onOpenTask={(nextTaskId) =>
          navigate({ to: ".", search: { taskId: nextTaskId }, replace: true })
        }
      />
      <TaskDetailsSheet
        taskId={taskId}
        projectId={projectId}
        workspaceId={workspaceId}
        onClose={() =>
          navigate({
            to: ".",
            search: {},
            replace: true,
          })
        }
      />
    </ProjectLayout>
  );
}
