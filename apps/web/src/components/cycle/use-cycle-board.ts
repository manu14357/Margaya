import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { usePlanningBoardFilters } from "@/hooks/use-planning-board-filters";
import { cycleTasksOf, scopeProjectToCycle } from "@/lib/cycle/scope";
import type { FilterCondition } from "@/lib/task-query/model";
import useProjectStore from "@/store/project";

/**
 * The project board scoped to one cycle, with its own saved filters and the
 * board's sort. Mirrors the board route: the tasks query feeds the project
 * store, which the board components read and update. Filters run through
 * the task query engine with the cycle as a fixed condition.
 */
export function useCycleBoard(projectId: string, cycleId: string) {
  const { t } = useTranslation();
  const { data } = useGetTasks(projectId);
  const { project, setProject } = useProjectStore();

  useEffect(() => {
    if (data) setProject(data);
  }, [data, setProject]);

  const backlogLabel = t("cycles:detail.backlogColumn");
  const scoped = useMemo(
    () =>
      project && project.id === projectId
        ? scopeProjectToCycle(project, cycleId, backlogLabel)
        : null,
    [project, projectId, cycleId, backlogLabel],
  );

  const baseConditions = useMemo<FilterCondition[]>(
    () => [{ key: "cycle", operator: "in", values: [cycleId] }],
    [cycleId],
  );
  const filters = usePlanningBoardFilters({
    workspaceId: data?.workspaceId ?? project?.workspaceId ?? "",
    projectId,
    storageScope: `cycle:${cycleId}`,
    project: scoped,
    baseConditions,
  });

  return {
    project: scoped,
    taskCount: cycleTasksOf(scoped).length,
    ...filters,
  };
}
