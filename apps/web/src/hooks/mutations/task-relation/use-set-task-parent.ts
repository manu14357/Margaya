import { useMutation, useQueryClient } from "@tanstack/react-query";
import setTaskParent from "@/fetchers/task-relation/set-task-parent";
import { parentRows, type RelationLike } from "@/lib/task-relations";

type Variables = {
  taskId: string;
  parentTaskId: string | null;
  /** The child's project, whose board shows sub-task counts. */
  projectId: string;
};

type Context = { oldParentIds: string[] };

/**
 * Sets, changes or clears a task's parent in one request, then refreshes the
 * child, its old and new parents' sub-task lists and history, and the board.
 */
function useSetTaskParent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, parentTaskId }: Variables) =>
      setTaskParent({ taskId, parentTaskId }),
    onMutate: ({ taskId }: Variables): Context => {
      const relations =
        queryClient.getQueryData<RelationLike[]>(["task-relations", taskId]) ??
        [];
      return {
        oldParentIds: parentRows(relations, taskId).map(
          (row) => row.sourceTaskId,
        ),
      };
    },
    onSuccess: (_result, { taskId, parentTaskId, projectId }, context) => {
      const parents = new Set([
        ...(context?.oldParentIds ?? []),
        ...(parentTaskId ? [parentTaskId] : []),
      ]);
      for (const id of [taskId, ...parents]) {
        queryClient.invalidateQueries({ queryKey: ["task-relations", id] });
        queryClient.invalidateQueries({ queryKey: ["activities", id] });
      }
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
  });
}

export default useSetTaskParent;
