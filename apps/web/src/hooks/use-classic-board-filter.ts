import { useMemo } from "react";
import type { TaskToolbarStatus } from "@/components/task-filters/task-toolbar";
import { useTaskQueryIdsFor } from "@/hooks/queries/task-query/use-task-query-rows";
import { filterProjectByIds, matchesTextQuery } from "@/lib/task-query/classic";
import { countConditions } from "@/lib/task-query/filter-tree";
import type {
  ArchivedFilter,
  FilterCondition,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import type { ProjectWithTasks } from "@/types/project";

type TasksHolder = Pick<ProjectWithTasks, "columns"> &
  Partial<Pick<ProjectWithTasks, "plannedTasks" | "archivedTasks" | "slug">>;

type Options<T extends TasksHolder> = {
  workspaceId: string;
  projectId: string;
  state: Pick<TaskQueryState, "filters" | "archived" | "display">;
  project: T | null | undefined;
  baseConditions?: readonly FilterCondition[];
  /** The board's own text search, applied in the browser. */
  textQuery?: string;
  descriptionMatches?: ReadonlySet<string>;
  /** The backlog lists archived tasks itself, so it asks for them too. */
  archived?: ArchivedFilter;
};

/**
 * Classic mode's filtering (B4 K9): when a condition is set, the engine
 * returns every matching id (ids mode) and the loaded board keeps only
 * those. The previous ids stay while new filters load; on an error, or
 * when there are too many matches, the board stays unfiltered.
 */
export function useClassicBoardFilter<T extends TasksHolder>({
  workspaceId,
  projectId,
  state,
  project,
  baseConditions,
  textQuery,
  descriptionMatches,
  archived,
}: Options<T>) {
  const scope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  const hasConditions =
    countConditions(state.filters) > 0 || !state.display.showSubTasks;
  const idsState = useMemo(
    () => ({
      filters: state.filters,
      archived: archived ?? state.archived,
      display: state.display,
    }),
    [state.filters, state.archived, state.display, archived],
  );
  const ids = useTaskQueryIdsFor({
    workspaceId,
    scope,
    state: idsState,
    baseConditions,
    enabled: hasConditions && Boolean(projectId),
  });

  const truncated = hasConditions && Boolean(ids.data?.truncated);
  const idSet =
    hasConditions && ids.data && !ids.isError && !truncated
      ? ids.data.ids
      : null;
  const slug = project?.slug ?? undefined;

  const filteredProject = useMemo(() => {
    if (!project) return null;
    const needle = textQuery?.trim();
    if (!idSet && !needle) return project;
    return filterProjectByIds(project, idSet, (task) =>
      matchesTextQuery(task, needle, slug, descriptionMatches),
    );
  }, [project, idSet, textQuery, slug, descriptionMatches]);

  const status: TaskToolbarStatus = {
    isFetching: hasConditions && ids.isFetching,
    error: hasConditions ? ids.error : null,
    onRetry: () => void ids.refetch(),
    truncated,
  };

  return {
    filteredProject,
    status,
    /** Filters are set but their first ids haven't arrived yet. */
    isPendingFilter: hasConditions && !ids.data && ids.isLoading,
  };
}
