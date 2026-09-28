import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskRelation from "@/fetchers/task-relation/delete-task-relation";
import type { RelationLike } from "@/lib/task-relations";

type Context = { previous?: RelationLike[]; otherTaskId?: string };

/**
 * Removes a relation from the task's list at once, restoring it when the
 * request fails; then refreshes the relations and history of both tasks.
 */
function useDeleteTaskRelation(taskId: string) {
  const queryClient = useQueryClient();
  const key = ["task-relations", taskId];

  return useMutation({
    mutationFn: deleteTaskRelation,
    onMutate: async (relationId: string): Promise<Context> => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RelationLike[]>(key);
      const relation = previous?.find((row) => row.id === relationId);
      const otherTaskId =
        relation?.sourceTaskId === taskId
          ? relation.targetTaskId
          : relation?.sourceTaskId;
      queryClient.setQueryData<RelationLike[]>(key, (rows) =>
        rows?.filter((row) => row.id !== relationId),
      );
      return { previous, otherTaskId };
    },
    onError: (_error, _relationId, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: (_data, _error, _relationId, context) => {
      for (const id of [taskId, context?.otherTaskId]) {
        if (!id) continue;
        queryClient.invalidateQueries({ queryKey: ["task-relations", id] });
        queryClient.invalidateQueries({ queryKey: ["activities", id] });
      }
      // The timeline's dependency lines.
      queryClient.invalidateQueries({
        queryKey: ["task-relations", "project"],
      });
    },
  });
}

export default useDeleteTaskRelation;
