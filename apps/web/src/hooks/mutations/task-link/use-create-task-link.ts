import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskLink from "@/fetchers/task-link/create-task-link";
import { taskLinksQueryKey } from "@/hooks/queries/task-link/use-get-task-links";

/** Not optimistic: the server normalizes the URL, so its row is shown. */
function useCreateTaskLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTaskLink,
    onSuccess: (_link, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskLinksQueryKey(taskId) });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
    },
  });
}

export default useCreateTaskLink;
