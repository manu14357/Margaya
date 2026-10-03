import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { setPublicBoardVote } from "@/fetchers/public-board/public-board-participation";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";
import { applyVote } from "@/lib/public-board/board-state";
import { toast } from "@/lib/toast";
import type { PublicTaskDetail, PublicVoteState } from "@/types/public-board";

type Variables = { value: 1 | -1 | null; next: PublicVoteState };
type Context = { previous?: PublicTaskDetail };

/**
 * My vote on the peek's task: clicking my vote removes it, the other
 * button switches it. Optimistic, rolled back on failure.
 */
export function usePublicBoardVote(token: string, number: number) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = publicBoardKeys.task(token, number);

  const mutation = useMutation<PublicVoteState, Error, Variables, Context>({
    mutationFn: ({ value }) => setPublicBoardVote(token, number, value),
    onMutate: async ({ next }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PublicTaskDetail>(key);
      if (previous) {
        queryClient.setQueryData<PublicTaskDetail>(key, {
          ...previous,
          votes: next,
        });
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(error.message || t("publicProject:votes.error"));
    },
    onSuccess: (votes) => {
      queryClient.setQueryData<PublicTaskDetail>(key, (task) =>
        task ? { ...task, votes } : task,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: publicBoardKeys.tasksAll(token),
      });
    },
    meta: { refreshTaskQueries: false },
  });

  const { mutate, isPending } = mutation;
  const vote = useCallback(
    (clicked: 1 | -1) => {
      if (isPending) return;
      const current = queryClient.getQueryData<PublicTaskDetail>(key)?.votes;
      if (!current) return;
      mutate(applyVote(current, clicked));
    },
    [isPending, key, mutate, queryClient],
  );

  return { vote, isPending };
}
