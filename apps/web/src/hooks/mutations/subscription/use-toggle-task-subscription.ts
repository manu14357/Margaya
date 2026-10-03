import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import subscribeToTask from "@/fetchers/subscription/subscribe-to-task";
import unsubscribeFromTask from "@/fetchers/subscription/unsubscribe-from-task";
import { taskSubscriptionKey } from "@/hooks/queries/subscription/use-task-subscription";
import { invalidateTaskQueries } from "@/lib/task-query/cache";
import { toast } from "@/lib/toast";
import type { TaskSubscription } from "@/types/subscription";

type Context = { previous?: TaskSubscription };

/** The state the server answers for a subscribe or unsubscribe. */
export function optimisticSubscription(
  current: TaskSubscription,
  subscribe: boolean,
): TaskSubscription {
  if (subscribe === current.subscribed) return current;
  return subscribe
    ? {
        ...current,
        subscribed: true,
        isMuted: false,
        reason: "manual",
        subscriberCount: current.subscriberCount + 1,
      }
    : {
        ...current,
        subscribed: false,
        isMuted: true,
        reason: null,
        subscriberCount: Math.max(0, current.subscriberCount - 1),
      };
}

/** Subscribes or unsubscribes me; optimistic, rolled back on failure. */
function useToggleTaskSubscription(taskId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = taskSubscriptionKey(taskId);

  return useMutation<TaskSubscription, Error, boolean, Context>({
    mutationFn: (subscribe) =>
      subscribe ? subscribeToTask(taskId) : unsubscribeFromTask(taskId),
    onMutate: async (subscribe) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskSubscription>(key);
      if (previous) {
        queryClient.setQueryData(
          key,
          optimisticSubscription(previous, subscribe),
        );
      }
      return { previous };
    },
    onError: (_error, _subscribe, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(t("tasks:subscription.error"));
    },
    onSuccess: (data, subscribe) => {
      queryClient.setQueryData(key, data);
      toast.success(
        subscribe
          ? t("tasks:subscription.toastSubscribed")
          : t("tasks:subscription.toastUnsubscribed"),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      // Subscribed views, "Your work" and the subscriber filter follow.
      void invalidateTaskQueries(queryClient);
    },
  });
}

export default useToggleTaskSubscription;
