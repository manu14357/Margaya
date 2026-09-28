import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskAttachment from "@/fetchers/task-attachment/delete-task-attachment";
import type { TaskAttachment } from "@/fetchers/task-attachment/get-task-attachments";
import { taskAttachmentsQueryKey } from "@/hooks/queries/task-attachment/use-get-task-attachments";

type Context = { previous?: TaskAttachment[] };

/** Removes the row at once and restores it when the request fails. */
function useDeleteTaskAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTaskAttachment,
    onMutate: async ({ taskId, attachmentId }): Promise<Context> => {
      const key = taskAttachmentsQueryKey(taskId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskAttachment[]>(key);
      queryClient.setQueryData<TaskAttachment[]>(key, (attachments) =>
        attachments?.filter((attachment) => attachment.id !== attachmentId),
      );
      return { previous };
    },
    onError: (_error, { taskId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          taskAttachmentsQueryKey(taskId),
          context.previous,
        );
      }
    },
    onSettled: (_result, _error, { taskId }) => {
      queryClient.invalidateQueries({
        queryKey: taskAttachmentsQueryKey(taskId),
      });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
    },
  });
}

export default useDeleteTaskAttachment;
