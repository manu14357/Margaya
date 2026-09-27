import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import addReaction from "@/fetchers/reaction/add-reaction";
import removeReaction from "@/fetchers/reaction/remove-reaction";
import { taskReactionsKey } from "@/hooks/queries/reaction/use-task-reactions";
import { applyReactionToggle, type ReactionUserLike } from "@/lib/reactions";
import { toast } from "@/lib/toast";
import type { ReactionGroup, TaskReactions } from "@/types/reaction";

export type ToggleReactionInput = {
  /** Left out for a reaction on the task itself. */
  commentId?: string;
  emoji: ReactionGroup["emoji"];
  /** Whether I have this reaction now (the toggle removes it). */
  reacted: boolean;
};

type Context = { previous?: TaskReactions };

const pendingKey = (input: ToggleReactionInput) =>
  `${input.commentId ?? "task"}:${input.emoji}`;

/** The task's reactions with one target's groups replaced. */
export function updateTargetGroups(
  data: TaskReactions | undefined,
  commentId: string | undefined,
  update: (groups: ReactionGroup[]) => ReactionGroup[],
): TaskReactions {
  const base = data ?? { task: [], comments: [] };
  if (!commentId) return { ...base, task: update(base.task) };
  const existing = base.comments.find((entry) => entry.commentId === commentId);
  const groups = update(existing?.groups ?? []);
  const others = base.comments.filter((entry) => entry.commentId !== commentId);
  return {
    ...base,
    comments: groups.length > 0 ? [...others, { commentId, groups }] : others,
  };
}

/**
 * Toggles my reaction on a task or one of its comments. Optimistic and
 * rolled back on failure; a second click on the same chip while its
 * request is in flight is ignored.
 */
function useToggleReaction(taskId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const pending = useRef(new Set<string>());
  const key = taskReactionsKey(taskId);

  const mutation = useMutation<unknown, Error, ToggleReactionInput, Context>({
    mutationFn: ({ commentId, emoji, reacted }) =>
      reacted
        ? removeReaction({ taskId, commentId }, emoji)
        : addReaction({ taskId, commentId }, emoji),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskReactions>(key);
      if (user?.id) {
        const me: ReactionUserLike = {
          id: user.id,
          name: user.name ?? "",
          image: user.image ?? null,
        };
        queryClient.setQueryData<TaskReactions>(key, (data) =>
          updateTargetGroups(data, input.commentId, (groups) =>
            applyReactionToggle(groups, input.emoji, me),
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(t("activity:reactions.error"));
    },
    onSettled: (_data, _error, input) => {
      pending.current.delete(pendingKey(input));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const { mutate } = mutation;
  const toggle = useCallback(
    (input: ToggleReactionInput) => {
      const inputKey = pendingKey(input);
      if (pending.current.has(inputKey)) return;
      pending.current.add(inputKey);
      mutate(input);
    },
    [mutate],
  );

  return { toggle };
}

export default useToggleReaction;
