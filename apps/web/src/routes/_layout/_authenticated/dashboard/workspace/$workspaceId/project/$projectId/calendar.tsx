import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import ProjectCalendar from "@/components/calendar/project-calendar";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import ProjectFilterBar from "@/components/task-filters/project-filter-bar";
import { shortcuts } from "@/constants/shortcuts";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useProjectLayoutFilter } from "@/hooks/use-project-layout-filter";
import { useUserPreferencesStore } from "@/store/user-preferences";

type CalendarSearchParams = {
  taskId?: string;
  /** The day selected in the touch month or week view, `yyyy-MM-dd`. */
  day?: string;
};

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/calendar",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): CalendarSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
    day:
      typeof search.day === "string" && DAY_PARAM.test(search.day)
        ? search.day
        : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId, day } = Route.useSearch();
  const navigate = useNavigate();
  const { data: loadedProject, isLoading, isError } = useGetTasks(projectId);
  const {
    queryState,
    filteredProject: project,
    status: filterStatus,
  } = useProjectLayoutFilter({
    workspaceId,
    projectId,
    project: loadedProject,
  });
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);

  const handleOpenTask = useCallback(
    (nextTaskId: string) => {
      navigate({
        to: ".",
        search: (previous: CalendarSearchParams) => ({
          ...previous,
          taskId: nextTaskId,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: CalendarSearchParams) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const handleSelectedDayChange = useCallback(
    (nextDay: string | undefined) => {
      navigate({
        to: ".",
        search: (previous: CalendarSearchParams) => ({
          ...previous,
          day: nextDay,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.view.prefix]: {
        [shortcuts.view.board]: () => {
          setViewMode("board");
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.list]: () => {
          setViewMode("list");
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.backlog]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.gantt]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.calendar]: () => {},
      },
    },
  });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="calendar"
    >
      <PageTitle
        title={t("tasks:calendar.pageTitle", { name: project?.name })}
        hideAppName
      />
      <ProjectCalendar
        workspaceId={workspaceId}
        projectId={projectId}
        loadedProject={loadedProject}
        project={project}
        isLoading={isLoading}
        isError={isError}
        onOpenTask={handleOpenTask}
        selectedDay={day}
        onSelectedDayChange={handleSelectedDayChange}
        renderToolbar={(calendarToolbar) => (
          <ProjectFilterBar
            workspaceId={workspaceId}
            projectId={projectId}
            handle={queryState}
            status={filterStatus}
            trailing={calendarToolbar}
          />
        )}
      />
      <TaskDetailsSheet
        taskId={taskId}
        projectId={projectId}
        workspaceId={workspaceId}
        onClose={handleCloseTaskSheet}
      />
    </ProjectLayout>
  );
}
