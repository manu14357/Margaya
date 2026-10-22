import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import BulkToolbar from "@/components/bulk-selection/bulk-toolbar";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import Spreadsheet from "@/components/spreadsheet/spreadsheet";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import TaskToolbar from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import SaveViewActions from "@/components/view/save-view-actions";
import { shortcuts } from "@/constants/shortcuts";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { defaultDisplay } from "@/lib/task-query/display";
import type { TaskQueryScope } from "@/lib/task-query/model";
import { useUserPreferencesStore } from "@/store/user-preferences";

type SpreadsheetSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/spreadsheet",
)({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): SpreadsheetSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

/** Rows per spreadsheet page (B4 §3.7). */
const SPREADSHEET_PAGE_SIZE = 100;

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId } = Route.useSearch();
  const navigate = useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);

  // The Tasks section's filters and display, shared with the board.
  const queryState = useTaskQueryState({
    storageScope: projectId,
    scope: "project",
    workspaceId,
    legacy: { filtersScope: projectId, sortProjectId: projectId },
  });
  const scope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  const { isEnabled: isFeatureEnabled } = useProjectFeatures({
    projectId,
    workspaceId,
  });
  const displayConfig = useDisplayConfig({
    workspaceId,
    scope,
    layout: "spreadsheet",
  });
  const rows = useTaskQueryRows({
    workspaceId,
    scope,
    state: queryState.state,
    limit: SPREADSHEET_PAGE_SIZE,
    ungrouped: true,
  });

  const goTo = useCallback(
    (view: "board" | "list" | "backlog" | "calendar" | "gantt") => {
      const params = { workspaceId, projectId };
      switch (view) {
        case "board":
        case "list":
          setViewMode(view);
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params,
          });
          return;
        case "backlog":
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
            params,
          });
          return;
        case "calendar":
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
            params,
          });
          return;
        case "gantt":
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
            params,
          });
      }
    },
    [navigate, setViewMode, workspaceId, projectId],
  );

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.view.prefix]: {
        [shortcuts.view.board]: () => goTo("board"),
        [shortcuts.view.list]: () => goTo("list"),
        [shortcuts.view.backlog]: () => goTo("backlog"),
        [shortcuts.view.calendar]: () => goTo("calendar"),
        [shortcuts.view.gantt]: () => goTo("gantt"),
        [shortcuts.view.spreadsheet]: () => {},
      },
    },
  });

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  const { display, displayProperties } = queryState;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="spreadsheet"
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${t("tasks:view.spreadsheet")}`}
        hideAppName
      />
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <TaskToolbar
          workspaceId={workspaceId}
          scope={scope}
          handle={queryState}
          displayConfig={displayConfig}
          rightSlot={
            isFeatureEnabled("views") ? (
              <SaveViewActions
                workspaceId={workspaceId}
                projectId={projectId}
                handle={queryState}
                layout="spreadsheet"
              />
            ) : null
          }
          status={{
            isFetching: rows.isFetching && Boolean(rows.data),
            error: rows.data ? rows.error : null,
            onRetry: () => void rows.refetch(),
          }}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Spreadsheet
            query={rows}
            workspaceId={workspaceId}
            scope={scope}
            properties={displayProperties}
            availableProperties={displayConfig.propertyKeys}
            orderBy={display.orderBy}
            onSort={(orderBy) =>
              queryState.updateDisplay({
                orderBy: orderBy ?? defaultDisplay("project").orderBy,
              })
            }
            onHideColumn={(property) =>
              queryState.setDisplayProperty(property, false)
            }
            onHideCustomField={(fieldId) =>
              queryState.setCustomFieldColumns(
                displayProperties.customFields.filter((id) => id !== fieldId),
              )
            }
            onClearFilters={
              queryState.hasActiveFilters ? queryState.clearFilters : undefined
            }
            quickAdd={queryState.state.archived !== "only"}
          />
        </div>
        <BulkToolbar projectId={projectId} />
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
