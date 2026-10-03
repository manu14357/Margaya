import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  type PublicReactionTarget,
  togglePublicBoardReaction,
} from "@/fetchers/public-board/public-board-participation";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";
import { applyPublicReaction } from "@/lib/public-board/board-state";
import { toast } from "@/lib/toast";
import type {
  PublicCommentPage,
  PublicReactionGroup,
  PublicTaskDetail,
} from "@/types/public-board";

export type PublicReactionInput = {
  target: PublicReactionTarget;
  emoji: PublicReactionGroup["emoji"];
  /** I have this reaction now: the toggle removes it. */
  reacted: boolean;
};

type Context = { key: QueryKey; previous: unknown };

type Groups = (groups: readonly PublicReactionGroup[]) => PublicReactionGroup[];

const pendingKey = ({ target, emoji }: PublicReactionInput) =>
  `${target.kind === "task" ? "task" : target.commentId}:${emoji}`;

/**
 * Toggles my reaction on the peek's task or one of its public comments.
 * Optimistic (counts only), rolled back with the server's message on
 * failure; a second click on the same chip in flight is ignored.
 */
export function useTogglePublicBoardReaction(token: string, number: number) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pending = useRef(new Set<string>());

  const update = useCallback(
    (target: PublicReactionTarget, change: Groups) => {
      if (target.kind === "task") {
        queryClient.setQueryData<PublicTaskDetail>(
          publicBoardKeys.task(token, number),
          (task) =>
            task ? { ...task, reactions: change(task.reactions ?? []) } : task,
        );
        return;
      }
      queryClient.setQueryData<InfiniteData<PublicCommentPage>>(
        publicBoardKeys.comments(token, number),
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((comment) =>
                comment.id === target.commentId
                  ? { ...comment, reactions: change(comment.reactions ?? []) }
                  : comment,
              ),
            })),
          },
      );
    },
    [queryClient, token, number],
  );

  const mutation = useMutation<
    PublicReactionGroup[],
    Error,
    PublicReactionInput,
    Context
  >({
    mutationFn: ({ target, emoji, reacted }) =>
      togglePublicBoardReaction(token, target, emoji, !reacted),
    onMutate: async ({ target, emoji }) => {
      const key =
        target.kind === "task"
          ? publicBoardKeys.task(token, number)
          : publicBoardKeys.comments(token, number);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      update(target, (groups) => applyPublicReaction(groups, emoji));
      return { key, previous };
    },
    onError: (error, _input, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
      toast.error(error.message || t("publicProject:reactions.error"));
    },
    onSuccess: (groups, { target }) => update(target, () => groups),
    onSettled: (_data, _error, input) => {
      pending.current.delete(pendingKey(input));
      // The cards show the top reactions.
      void queryClient.invalidateQueries({
        queryKey: publicBoardKeys.tasksAll(token),
      });
    },
    meta: { refreshTaskQueries: false },
  });

  const { mutate } = mutation;
  const toggle = useCallback(
    (input: PublicReactionInput) => {
      const key = pendingKey(input);
      if (pending.current.has(key)) return;
      pending.current.add(key);
      mutate(input);
    },
    [mutate],
  );

  return { toggle };
}
