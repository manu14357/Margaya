import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteComment from "@/fetchers/comment/delete-comment";

function useDeleteComment(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      // A deleted comment takes its reactions with it.
      queryClient.invalidateQueries({ queryKey: ["reactions", taskId] });
    },
  });
}

export default useDeleteComment;
