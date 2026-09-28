import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskLink from "@/fetchers/task-link/delete-task-link";
import type { TaskLink } from "@/fetchers/task-link/get-task-links";
import { taskLinksQueryKey } from "@/hooks/queries/task-link/use-get-task-links";

type Context = { previous?: TaskLink[] };

/** Removes the row at once and restores it when the request fails. */
function useDeleteTaskLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTaskLink,
    onMutate: async ({ taskId, linkId }): Promise<Context> => {
      const key = taskLinksQueryKey(taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskLink[]>(key);
      queryClient.setQueryData<TaskLink[]>(key, (links) =>
        links?.filter((link) => link.id !== linkId),
      );
      return { previous };
    },
    onError: (_error, { taskId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(taskLinksQueryKey(taskId), context.previous);
      }
    },
    onSettled: (_result, _error, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskLinksQueryKey(taskId) });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
    },
  });
}

export default useDeleteTaskLink;
