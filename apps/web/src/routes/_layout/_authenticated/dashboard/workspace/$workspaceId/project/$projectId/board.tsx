import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BuildWithAiEmptyHint from "@/components/ai-build/build-with-ai-empty-hint";
import BoardToolbar from "@/components/board/board-toolbar";
import BulkToolbar from "@/components/bulk-selection/bulk-toolbar";
import ProjectLayout from "@/components/common/project-layout";
import KanbanBoard from "@/components/kanban-board";
import ListView from "@/components/list-view";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import TaskQueryView from "@/components/task-layouts/task-query-view";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import SaveViewActions from "@/components/view/save-view-actions";
import { shortcuts } from "@/constants/shortcuts";
import { useEstimateSort } from "@/hooks/queries/estimate/use-estimate-sort";
import { useDescriptionMatches } from "@/hooks/queries/task/use-description-matches";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useLoadFailure } from "@/hooks/use-load-failure";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { sortTasks } from "@/lib/sort-tasks";
import { isClassicDisplay, toSortConfig } from "@/lib/task-query/display";
import type { TaskQueryScope } from "@/lib/task-query/model";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";

type BoardSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/board",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): BoardSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

const skeletonColumns = [
  { key: "col-todo", cards: 3 },
  { key: "col-progress", cards: 4 },
  { key: "col-review", cards: 2 },
  { key: "col-done", cards: 1 },
];

function BoardSkeleton() {
  return (
    <div className="flex h-full w-full gap-3 overflow-hidden p-3">
      {skeletonColumns.map((col) => (
        <div
          key={col.key}
          className="flex w-[296px] shrink-0 flex-col gap-1.5 rounded-xl bg-muted/50 p-1.5"
        >
          <div className="flex h-7 items-center gap-2 px-1">
            <div className="h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-5 animate-pulse rounded bg-muted" />
          </div>
          {Array.from({ length: col.cards }, (_, i) => `${col.key}-${i}`).map(
            (cardKey) => (
              <div
                key={cardKey}
                className="space-y-2 rounded-lg border border-border/60 bg-background px-2.5 py-2"
              >
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="h-4 w-10 animate-pulse rounded bg-muted" />
                  <div className="ms-auto h-4 w-4 animate-pulse rounded-full bg-muted" />
                </div>
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId } = Route.useSearch();
  const navigate = useNavigate();
  const tasksQuery = useGetTasks(projectId);
  const { data } = tasksQuery;
  const loadFailure = useLoadFailure(tasksQuery);
  const { project, setProject } = useProjectStore();
  const { viewMode, setViewMode } = useUserPreferencesStore();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [isBoardSearchOpen, setIsBoardSearchOpen] = useState(false);
  const [boardSearchInput, setBoardSearchInput] =
    useState<HTMLInputElement | null>(null);
  const boardSearchButton = useRef<HTMLButtonElement>(null);
  // Filters and display of the Tasks section, shared by its layouts; the
  // old board filters and sort are converted on first load (B4 §3.9).
  const queryState = useTaskQueryState({
    storageScope: projectId,
    scope: "project",
    workspaceId,
    legacy: { filtersScope: projectId, sortProjectId: projectId },
  });
  const isClassic = isClassicDisplay(queryState.display, queryState.archived);
  const { sort, context: sortContext } = useEstimateSort({
    projectId,
    workspaceId,
    sort: toSortConfig(queryState.display.orderBy),
  });
  const queryScope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  const { isEnabled: isFeatureEnabled } = useProjectFeatures({
    projectId,
    workspaceId,
  });

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: {},
      replace: true,
    });
  }, [navigate]);

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.view.prefix]: {
        [shortcuts.view.board]: () => setViewMode("board"),
        [shortcuts.view.list]: () => setViewMode("list"),
        [shortcuts.view.calendar]: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
            params: { workspaceId, projectId },
          }),
        [shortcuts.view.gantt]: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
            params: { workspaceId, projectId },
          }),
        [shortcuts.view.backlog]: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
            params: { workspaceId, projectId },
          }),
        [shortcuts.view.spreadsheet]: () =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/spreadsheet",
            params: { workspaceId, projectId },
          }),
      },
    },
  });

  useEffect(() => {
    if (data) {
      setProject(data);
    }
  }, [data, setProject]);

  const openBoardSearch = useCallback(() => {
    setIsBoardSearchOpen(true);
    boardSearchInput?.focus();
  }, [boardSearchInput]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isFindShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";

      if (!isFindShortcut) return;

      event.preventDefault();
      openBoardSearch();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openBoardSearch]);

  // The field mounts when it opens, so it takes focus once its ref arrives.
  useEffect(() => {
    boardSearchInput?.focus();
  }, [boardSearchInput]);

  const descriptionSearch = useDescriptionMatches(
    projectId,
    project,
    boardSearchQuery,
  );

  const classicFilter = useClassicBoardFilter({
    workspaceId,
    projectId,
    state: queryState.state,
    project: project?.id === projectId ? project : null,
    textQuery: boardSearchQuery,
    descriptionMatches: descriptionSearch.ids,
  });
  const { filteredProject } = classicFilter;

  // Any other grouping, a sub-group or archived tasks run in query mode.
  const rows = useTaskQueryRows({
    workspaceId,
    scope: queryScope,
    state: queryState.state,
    search: boardSearchQuery,
    enabled: !isClassic,
  });

  const sortedProject = useMemo(() => {
    if (!filteredProject || sort.field === "position") return filteredProject;
    return {
      ...filteredProject,
      columns: filteredProject.columns.map((column) => ({
        ...column,
        tasks: sortTasks(column.tasks, sort, sortContext),
      })),
    };
  }, [filteredProject, sort, sortContext]);

  const boardSearch = isBoardSearchOpen ? (
    <div className="relative w-36 sm:w-60">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        ref={setBoardSearchInput}
        value={boardSearchQuery}
        maxLength={256}
        aria-label={t("tasks:boardSearchOpen")}
        onChange={(event) => setBoardSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !boardSearchQuery.trim()) {
            setIsBoardSearchOpen(false);
            // Back to the button that took the field's place.
            window.requestAnimationFrame(() =>
              boardSearchButton.current?.focus(),
            );
          }
        }}
        onBlur={() => {
          if (!boardSearchQuery.trim()) {
            setIsBoardSearchOpen(false);
          }
        }}
        placeholder={t("tasks:boardSearchPlaceholder")}
        className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:leading-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs [&_[data-slot=input]]:placeholder:text-xs [&_[data-slot=input]]:placeholder:leading-7"
      />
    </div>
  ) : (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={boardSearchButton}
            variant="outline"
            size="icon-xs"
            aria-label={t("tasks:boardSearchOpen")}
            onClick={openBoardSearch}
          />
        }
      >
        <Search className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{t("tasks:boardSearchOpen")}</TooltipContent>
    </Tooltip>
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView={viewMode}
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${viewMode === "board" ? t("tasks:view.board") : t("tasks:view.list")}`}
        hideAppName
      />
      <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
        <BoardToolbar
          workspaceId={workspaceId}
          projectId={projectId}
          handle={queryState}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showLayoutToggle={false}
          actions={
            <>
              {boardSearch}
              {isFeatureEnabled("views") && (
                <SaveViewActions
                  workspaceId={workspaceId}
                  projectId={projectId}
                  handle={queryState}
                  layout={viewMode}
                />
              )}
            </>
          }
          status={
            isClassic
              ? classicFilter.status
              : {
                  isFetching: rows.isFetching && Boolean(rows.data),
                  error: rows.data ? rows.error : null,
                  onRetry: () => void rows.refetch(),
                }
          }
        />

        {!queryState.hasActiveFilters && (
          <BuildWithAiEmptyHint project={data} />
        )}

        {descriptionSearch.isLoading && (
          <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
            {t("tasks:descriptionSearchLoading")}
          </p>
        )}
        {descriptionSearch.isError && (
          <p role="alert" className="px-4 py-2 text-sm text-destructive">
            {t("tasks:descriptionSearchError")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void descriptionSearch.retry()}
            >
              {t("tasks:descriptionRetry")}
            </button>
          </p>
        )}

        <div className="flex h-full flex-1 overflow-hidden bg-background">
          {!isClassic ? (
            <>
              <TaskQueryView
                query={rows}
                layout={viewMode}
                properties={queryState.displayProperties}
                workspaceId={workspaceId}
                storageKey={`project:${projectId}`}
                singleProject
                onClearFilters={
                  queryState.hasActiveFilters
                    ? queryState.clearFilters
                    : undefined
                }
                quickAdd={queryState.state.archived !== "only"}
                projectId={projectId}
              />
              <BulkToolbar />
            </>
          ) : sortedProject && !classicFilter.isPendingFilter ? (
            viewMode === "board" ? (
              <KanbanBoard
                project={sortedProject}
                disableDragDrop={sort.field !== "position"}
                capture
              />
            ) : (
              <ListView
                project={sortedProject}
                disableDragDrop={sort.field !== "position"}
                capture
              />
            )
          ) : loadFailure && !sortedProject ? (
            <div className="min-w-0 flex-1 overflow-auto p-4">
              <ErrorDisplay
                error={loadFailure.error}
                onRetry={loadFailure.retry}
              />
            </div>
          ) : (
            <BoardSkeleton />
          )}
        </div>

        <CreateTaskModal
          open={isTaskModalOpen}
          projectId={projectId}
          onClose={() => setIsTaskModalOpen(false)}
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
