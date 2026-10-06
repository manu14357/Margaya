import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import type { ProjectWithTasks } from "@/types/project";

type Options = {
  workspaceId: string;
  projectId: string;
  project: ProjectWithTasks | null | undefined;
};

/**
 * The Tasks section's filters for the layouts that draw the loaded project
 * themselves (Calendar and Gantt, B4 §6.6). The state is the one Board, List
 * and Spreadsheet keep for the project, so a filter set on one layout
 * applies on the others; the engine's ids narrow the loaded tasks.
 */
export function useProjectLayoutFilter({
  workspaceId,
  projectId,
  project,
}: Options) {
  const queryState = useTaskQueryState({
    storageScope: projectId,
    scope: "project",
    workspaceId,
    legacy: { filtersScope: projectId, sortProjectId: projectId },
  });
  const { filteredProject, status, isPendingFilter } = useClassicBoardFilter({
    workspaceId,
    projectId,
    state: queryState.state,
    project: project?.id === projectId ? project : null,
  });

  return { queryState, filteredProject, status, isPendingFilter };
}
