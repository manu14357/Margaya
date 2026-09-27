import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import getTasks from "@/fetchers/task/get-tasks";

export type TaskSiblings = {
  previousId: string | null;
  nextId: string | null;
  /** 1-based; 0 when the task is not on the project's board. */
  position: number;
  total: number;
};

const NONE: TaskSiblings = {
  previousId: null,
  nextId: null,
  position: 0,
  total: 0,
};

/**
 * The tasks before and after `taskId` in board order (column by column).
 *
 * With `fetch` off this only reads the board already cached by the board,
 * list or task page, so a sheet opened from Home or the Inbox never loads a
 * whole project just to offer previous/next.
 */
export function useTaskSiblings(
  projectId: string,
  taskId: string | undefined,
  { fetch = false }: { fetch?: boolean } = {},
): TaskSiblings {
  const { data } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: ({ signal }) => getTasks(projectId, signal),
    enabled: fetch && Boolean(projectId),
  });

  return useMemo(() => {
    if (!data || !taskId) return NONE;
    const ids = (data.columns ?? []).flatMap((column) =>
      column.tasks.map((task) => task.id),
    );
    const index = ids.indexOf(taskId);
    if (index === -1) return NONE;
    return {
      previousId: ids[index - 1] ?? null,
      nextId: ids[index + 1] ?? null,
      position: index + 1,
      total: ids.length,
    };
  }, [data, taskId]);
}
