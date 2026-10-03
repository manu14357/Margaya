import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPublicBoardComment,
  deletePublicBoardComment,
  updatePublicBoardComment,
} from "@/fetchers/public-board/public-board-comments";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";

// Public board writes never touch the app's task queries.
const meta = { refreshTaskQueries: false };

/** Post, edit and delete my comments on a public task. */
export function usePublicBoardCommentMutations(token: string, number: number) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: publicBoardKeys.comments(token, number),
    });
    void queryClient.invalidateQueries({
      queryKey: publicBoardKeys.task(token, number),
    });
    // Comment counts on the cards.
    void queryClient.invalidateQueries({
      queryKey: publicBoardKeys.tasksAll(token),
    });
  };

  const create = useMutation({
    mutationFn: (content: string) =>
      createPublicBoardComment(token, number, content),
    onSuccess: refresh,
    meta,
  });
  const update = useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: string;
      content: string;
    }) => updatePublicBoardComment(token, commentId, content),
    onSuccess: refresh,
    meta,
  });
  const remove = useMutation({
    mutationFn: (commentId: string) =>
      deletePublicBoardComment(token, commentId),
    onSuccess: refresh,
    meta,
  });

  return { create, update, remove };
}
