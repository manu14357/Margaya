import type {
  CreateTaskExportInput,
  TaskExportFormat,
} from "@/types/task-export";

export const TASK_EXPORT_FORMATS = [
  "csv",
  "xlsx",
  "json",
] as const satisfies readonly TaskExportFormat[];

/**
 * "One file per project" needs two projects in scope: two picked, or none
 * picked while "All projects" covers two or more active ones.
 */
export function canSplitByProject(
  selectedCount: number,
  activeProjectCount: number,
): boolean {
  return selectedCount >= 2 || (selectedCount === 0 && activeProjectCount >= 2);
}

/** The create body: no project ids means every non-archived project. */
export function buildExportInput({
  workspaceId,
  format,
  projectIds,
  split,
  includeArchived,
  activeProjectCount,
}: {
  workspaceId: string;
  format: TaskExportFormat;
  projectIds: readonly string[];
  split: boolean;
  includeArchived: boolean;
  activeProjectCount: number;
}): CreateTaskExportInput {
  return {
    workspaceId,
    format,
    projectIds: projectIds.length > 0 ? [...projectIds] : undefined,
    splitByProject:
      split && canSplitByProject(projectIds.length, activeProjectCount),
    includeArchived,
  };
}
