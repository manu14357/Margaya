import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { produce } from "immer";
import { ArrowRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BacklogListView from "@/components/backlog-list-view";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import TaskToolbar from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import { Button } from "@/components/ui/button";
import { shortcuts } from "@/constants/shortcuts";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import { useEstimateSort } from "@/hooks/queries/estimate/use-estimate-sort";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { getEntryColumn } from "@/lib/column-groups";
import { sortTasks } from "@/lib/sort-tasks";
import { toSortConfig } from "@/lib/task-query/display";
import type { TaskQueryScope } from "@/lib/task-query/model";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";

type BacklogSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/backlog",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): BacklogSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId } = Route.useSearch();
  const navigate = useNavigate();
  const { data } = useGetTasks(projectId);
  const { project, setProject } = useProjectStore();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const { mutate: updateTaskStatus } = useUpdateTaskStatus();
  // The backlog keeps its own filters and order; it lists planned and
  // archived tasks, so its ids include archived ones.
  const queryState = useTaskQueryState({
    storageScope: `backlog:${projectId}`,
    scope: "project",
    workspaceId,
  });
  const queryScope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  const displayConfig = useDisplayConfig({
    workspaceId,
    scope: queryScope,
    layout: "list",
    classicOnly: true,
  });
  const { sort, context: sortContext } = useEstimateSort({
    projectId,
    workspaceId,
    sort: toSortConfig(queryState.display.orderBy),
  });

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: {},
      replace: true,
    });
  }, [navigate]);

  const { setViewMode } = useUserPreferencesStore();

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
        [shortcuts.view.calendar]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.gantt]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.backlog]: () => {},
        [shortcuts.view.spreadsheet]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/spreadsheet",
            params: { workspaceId, projectId },
          });
        },
      },
    },
  });

  useEffect(() => {
    if (data) {
      setProject(data);
    }
  }, [data, setProject]);

  const { filteredProject, status, isPendingFilter } = useClassicBoardFilter({
    workspaceId,
    projectId,
    state: queryState.state,
    project: project?.id === projectId ? project : null,
    archived: "include",
  });

  const sortedProject = useMemo(() => {
    if (!filteredProject || sort.field === "position") return filteredProject;
    return {
      ...filteredProject,
      plannedTasks: sortTasks(
        filteredProject.plannedTasks || [],
        sort,
        sortContext,
      ),
      archivedTasks: sortTasks(
        filteredProject.archivedTasks || [],
        sort,
        sortContext,
      ),
    };
  }, [filteredProject, sort, sortContext]);

  // Planned work moves to the entry column: the first not-started column,
  // else the first open one.
  const entryColumn = getEntryColumn(project?.columns ?? []);

  const handleMoveAllPlannedToTodo = () => {
    if (!project || !entryColumn) return;
    const entrySlug = entryColumn.slug;

    const plannedTasks = project.plannedTasks || [];

    if (plannedTasks.length === 0) {
      toast.info(t("tasks:backlog.noTasksToMove"));
      return;
    }

    if (
      !confirm(
        t("tasks:backlog.moveAllConfirm", {
          count: plannedTasks.length,
          column: entryColumn.name,
        }),
      )
    ) {
      return;
    }

    for (const task of plannedTasks) {
      updateTaskStatus({
        ...task,
        status: entrySlug,
      });
    }

    const updatedProject = produce(project, (draft) => {
      // The status is a column slug, so it can only be matched against slug.
      const todoColumn = draft.columns?.find((col) => col.slug === entrySlug);
      if (todoColumn && draft.plannedTasks) {
        todoColumn.tasks.push(
          ...draft.plannedTasks.map((task) => ({
            ...task,
            status: entrySlug,
          })),
        );

        draft.plannedTasks = [];
      }
    });

    setProject(updatedProject);
    toast.success(
      t("tasks:backlog.moveAllSuccess", {
        count: plannedTasks.length,
        column: entryColumn.name,
      }),
    );
  };

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="backlog"
    >
      <PageTitle
        title={t("tasks:backlog.pageTitle", { name: project?.name })}
      />
      <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
        <TaskToolbar
          workspaceId={workspaceId}
          scope={queryScope}
          handle={queryState}
          displayConfig={displayConfig}
          showArchived={false}
          status={status}
          leftSlot={
            <>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsTaskModalOpen(true)}
                className="h-6 px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("tasks:backlog.plan")}
              </Button>

              <Button
                variant="ghost"
                size="xs"
                onClick={handleMoveAllPlannedToTodo}
                disabled={!entryColumn}
                className="h-6 px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title={t("tasks:backlog.moveAllTooltip", {
                  column: entryColumn?.name ?? "",
                })}
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                {t("tasks:backlog.moveAll")}
              </Button>
            </>
          }
        />

        <div className="flex-1 overflow-hidden bg-card h-full">
          {sortedProject && !isPendingFilter ? (
            <BacklogListView
              project={sortedProject}
              disableDragDrop={sort.field !== "position"}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-muted rounded-lg animate-pulse mx-auto" />
                <div className="space-y-2">
                  <div className="w-48 h-4 bg-muted rounded animate-pulse mx-auto" />
                  <div className="w-64 h-3 bg-muted rounded animate-pulse mx-auto" />
                </div>
              </div>
            </div>
          )}
        </div>

        <CreateTaskModal
          open={isTaskModalOpen}
          projectId={projectId}
          onClose={() => setIsTaskModalOpen(false)}
          status="planned"
        />

        <TaskDetailsSheet
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
          onClose={handleCloseTaskSheet}
        />
      </div>
    </ProjectLayout>
  );
}
