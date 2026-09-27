import { useMutation, useQueryClient } from "@tanstack/react-query";
import createComment from "@/fetchers/comment/create-comment";

function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createComment,
    onSuccess: (_data, { taskId }) => {
      // Commenting subscribes the author to the task.
      void queryClient.invalidateQueries({
        queryKey: ["task-subscription", taskId],
      });
      void queryClient.invalidateQueries({ queryKey: ["reactions", taskId] });
    },
  });
}

export default useCreateComment;
