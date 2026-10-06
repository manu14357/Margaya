import { useCallback, useMemo } from "react";
import type { PlanningFilterControls } from "@/components/planning/planning-breakdown";
import { useEstimateSort } from "@/hooks/queries/estimate/use-estimate-sort";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { sortTasks } from "@/lib/sort-tasks";
import { toSortConfig } from "@/lib/task-query/display";
import { type LabelRow, labelValues } from "@/lib/task-query/labels";
import type { FilterCondition } from "@/lib/task-query/model";
import type { BoardFilters } from "@/lib/task-query/planning-filters";
import {
  applyBoardFilter,
  boardFiltersFromTree,
  toggleLabelFilter,
} from "@/lib/task-query/planning-filters";
import type { ProjectWithTasks } from "@/types/project";

type Options = {
  workspaceId: string;
  projectId: string;
  /** `cycle:{id}` or `module:{id}`: the board's own saved filters. */
  storageScope: string;
  /** The board scoped to the cycle or module. */
  project: ProjectWithTasks | null;
  /** The page's own scope, ANDed with the filters (no chip). */
  baseConditions: readonly FilterCondition[];
};

/**
 * Filters of a cycle or module board: the classic board (the page keeps its
 * scoping and drag and drop) filtered through the task query engine, plus
 * the sidebar breakdown's controls over the same filters.
 */
export function usePlanningBoardFilters({
  workspaceId,
  projectId,
  storageScope,
  project,
  baseConditions,
}: Options) {
  const queryState = useTaskQueryState({
    storageScope,
    scope: "project",
    workspaceId,
    legacy: { filtersScope: storageScope, sortProjectId: projectId },
  });
  const { sort, context: sortContext } = useEstimateSort({
    projectId,
    workspaceId,
    sort: toSortConfig(queryState.display.orderBy),
  });
  const classic = useClassicBoardFilter({
    workspaceId,
    projectId,
    state: queryState.state,
    project,
    baseConditions,
  });
  const { filteredProject } = classic;

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

  const { data: labels = [] } = useGetLabelsByWorkspace(workspaceId);
  const { setFilters } = queryState;
  const updateFilter = useCallback(
    (key: keyof BoardFilters, value: BoardFilters[keyof BoardFilters]) =>
      setFilters((previous) => applyBoardFilter(previous, key, value)),
    [setFilters],
  );
  const updateLabelFilter = useCallback(
    (value: string) =>
      setFilters((previous) => toggleLabelFilter(previous, value)),
    [setFilters],
  );

  const planningControls: Omit<PlanningFilterControls, "columns"> = useMemo(
    () => ({
      filters: boardFiltersFromTree(queryState.filters),
      updateFilter,
      updateLabelFilter,
      // One entry per name, keyed by its filter value.
      workspaceLabels: labelValues(labels as LabelRow[]).map((label) => ({
        id: label.value,
        name: label.name,
      })),
    }),
    [queryState.filters, updateFilter, updateLabelFilter, labels],
  );

  return {
    queryState,
    sort,
    sortedProject,
    filterStatus: classic.status,
    isPendingFilter: classic.isPendingFilter,
    planningControls,
  };
}
