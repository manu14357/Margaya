import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskRelation from "@/fetchers/task-relation/create-task-relation";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";

function useCreateTaskRelation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTaskRelation,
    onSuccess: (_, variables) => {
      // Both tasks list the relation and record it in their history.
      for (const taskId of [variables.sourceTaskId, variables.targetTaskId]) {
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

export default useCreateTaskRelation;
