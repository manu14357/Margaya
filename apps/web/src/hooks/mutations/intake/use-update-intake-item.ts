import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateIntakeItem from "@/fetchers/intake/update-intake-item";
import { intakeQueryKeys } from "@/hooks/queries/intake/intake-query-keys";
import type { UpdateIntakeRequest } from "@/types/intake";
import {
  applyIntakeItemToLists,
  invalidateIntakeQueries,
} from "./invalidate-intake-queries";

/** The requester's edit of title, description and priority. */
export function useUpdateIntakeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...json }: UpdateIntakeRequest & { id: string }) =>
      updateIntakeItem(id, json),
    onSuccess: (item) => {
      queryClient.setQueryData(intakeQueryKeys.item(item.id), item);
      applyIntakeItemToLists(queryClient, item);
      invalidateIntakeQueries(queryClient, {
        projectId: item.projectId,
        taskId: item.taskId,
      });
      queryClient.invalidateQueries({ queryKey: ["task", item.taskId] });
    },
  });
}

export default useUpdateIntakeItem;
