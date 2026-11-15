import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskRelation from "@/fetchers/task-relation/delete-task-relation";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";

export type RelationToDelete = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
};

/**
 * Removes several relations that may join different tasks, then refreshes
 * the relations and history of every task involved. Resolves with how many
 * went; fails only when none could be removed.
 */
function useDeleteTaskRelations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (relations: readonly RelationToDelete[]) => {
      const results = await Promise.allSettled(
        relations.map((relation) => deleteTaskRelation(relation.id)),
      );
      const removed = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (removed === 0 && failure) throw failure.reason;
      return { removed, failed: relations.length - removed };
    },
    onSettled: (_data, _error, relations) => {
      const taskIds = new Set(
        relations.flatMap((relation) => [
          relation.sourceTaskId,
          relation.targetTaskId,
        ]),
      );
      for (const taskId of taskIds) {
        queryClient.invalidateQueries({ queryKey: ["task-relations", taskId] });
        queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      }
      // The timeline's dependency lines.
      queryClient.invalidateQueries({
        queryKey: ["task-relations", "project"],
      });
      // Risk radars follow blockers, across projects too.
      invalidateDeliveryQueries(queryClient);
    },
  });
}

export default useDeleteTaskRelations;
