import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetModuleTaskIds } from "@/hooks/queries/module/use-get-module-task-ids";
import { useModuleTaskIndex } from "@/hooks/queries/module/use-get-module-task-map";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { usePlanningBoardFilters } from "@/hooks/use-planning-board-filters";
import { cycleTasksOf } from "@/lib/cycle/scope";
import { scopeProjectToModule } from "@/lib/module/scope";
import type { FilterCondition } from "@/lib/task-query/model";
import useProjectStore from "@/store/project";

const NO_CONDITIONS: FilterCondition[] = [];

/**
 * The project board scoped to one module, with its own saved filters and
 * the board's sort. Mirrors the cycle page: the tasks query feeds the
 * project store, and the task map says which tasks belong to the module.
 * The task map skips archived modules, so an archived module's tasks come
 * from its own task list.
 */
export function useModuleBoard(
  projectId: string,
  moduleId: string,
  { enabled, archived }: { enabled: boolean; archived: boolean },
) {
  const { t } = useTranslation();
  const { data } = useGetTasks(projectId);
  const { project, setProject } = useProjectStore();
  const index = useModuleTaskIndex(projectId, {
    enabled: enabled && !archived,
  });
  const archivedTaskIds = useGetModuleTaskIds(projectId, moduleId, {
    enabled: enabled && archived,
  });

  useEffect(() => {
    if (data) setProject(data);
  }, [data, setProject]);

  const taskIds = archived
    ? archivedTaskIds.data
    : index.tasksByModule.get(moduleId);
  const isReady = archived ? archivedTaskIds.isSuccess : index.isReady;
  const backlogLabel = t("modules:detail.backlogColumn");
  const scoped = useMemo(
    () =>
      isReady && project && project.id === projectId
        ? scopeProjectToModule(project, taskIds, backlogLabel)
        : null,
    [isReady, project, projectId, taskIds, backlogLabel],
  );

  // The engine only counts active modules, so an archived module's board
  // keeps its client-side scope without the module condition.
  const baseConditions = useMemo<FilterCondition[]>(
    () =>
      archived
        ? NO_CONDITIONS
        : [{ key: "module", operator: "in", values: [moduleId] }],
    [archived, moduleId],
  );
  const filters = usePlanningBoardFilters({
    workspaceId: data?.workspaceId ?? project?.workspaceId ?? "",
    projectId,
    storageScope: `module:${moduleId}`,
    project: scoped,
    baseConditions,
  });

  return {
    project: scoped,
    /** The module's task ids, which "Add existing" leaves out. */
    moduleTaskIds: taskIds,
    taskCount: cycleTasksOf(scoped).length,
    ...filters,
  };
}
