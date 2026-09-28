import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskLink } from "@/fetchers/task-link/get-task-links";
import updateTaskLink from "@/fetchers/task-link/update-task-link";
import { taskLinksQueryKey } from "@/hooks/queries/task-link/use-get-task-links";

type Context = { previous?: TaskLink[] };

/** Patches the cached row at once; the server's normalized row follows. */
function useUpdateTaskLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateTaskLink,
    onMutate: async ({ taskId, linkId, changes }): Promise<Context> => {
      const key = taskLinksQueryKey(taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskLink[]>(key);
      queryClient.setQueryData<TaskLink[]>(key, (links) =>
        links?.map((link) =>
          link.id === linkId
            ? {
                ...link,
                ...(changes.url !== undefined ? { url: changes.url } : {}),
                ...(changes.title !== undefined
                  ? { title: changes.title }
                  : {}),
              }
            : link,
        ),
      );
      return { previous };
    },
    onError: (_error, { taskId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(taskLinksQueryKey(taskId), context.previous);
      }
    },
    onSettled: (_link, _error, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskLinksQueryKey(taskId) });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
    },
  });
}

export default useUpdateTaskLink;
