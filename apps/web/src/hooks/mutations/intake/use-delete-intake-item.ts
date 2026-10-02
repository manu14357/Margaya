import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteIntakeItem from "@/fetchers/intake/delete-intake-item";
import { intakeQueryKeys } from "@/hooks/queries/intake/intake-query-keys";
import {
  invalidateIntakeQueries,
  removeIntakeItemFromLists,
} from "./invalidate-intake-queries";

/** Deletes a request and its task, or withdraws the caller's own request. */
export function useDeleteIntakeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteIntakeItem(id),
    onSuccess: ({ id, taskId, projectId }) => {
      removeIntakeItemFromLists(queryClient, projectId, id);
      queryClient.removeQueries({ queryKey: intakeQueryKeys.item(id) });
      queryClient.removeQueries({ queryKey: ["task", taskId] });
      queryClient.removeQueries({ queryKey: intakeQueryKeys.byTask(taskId) });
      invalidateIntakeQueries(queryClient, { projectId });
    },
  });
}

export default useDeleteIntakeItem;
