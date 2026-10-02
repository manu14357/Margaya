import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import updateNotificationState from "@/fetchers/notification/update-notification-state";
import {
  applyActionToPages,
  applyCountDelta,
  countDelta,
  filtersOfKey,
  type InboxRowState,
  inboxQueryKeys,
} from "@/lib/inbox-cache";
import { formatSnoozeTarget } from "@/lib/snooze-presets";
import { toast } from "@/lib/toast";
import type {
  InboxCounts,
  InboxPage,
  NotificationStateAction,
} from "@/types/notification";

export type UpdateNotificationStateInput = {
  id: string;
  change: NotificationStateAction;
  /** No toast: reads on selection and the Undo of an earlier action. */
  silent?: boolean;
};

type Context = { snapshot: Array<[QueryKey, unknown]> };

/**
 * Changes one notification's read, archive or snooze state. Optimistic in
 * every cached inbox page and count; archive and snooze toast with Undo.
 */
function useUpdateNotificationState() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutateRef = useRef<(input: UpdateNotificationStateInput) => void>(
    () => {},
  );

  const notify = ({ id, change }: UpdateNotificationStateInput) => {
    const undo = (inverse: NotificationStateAction) => ({
      label: t("notifications:inbox.toasts.undo"),
      onClick: () => mutateRef.current({ id, change: inverse, silent: true }),
    });
    switch (change.action) {
      case "archive":
        toast.success(t("notifications:inbox.toasts.archived"), {
          action: undo({ action: "unarchive" }),
        });
        return;
      case "snooze":
        toast.success(
          t("notifications:inbox.toasts.snoozed", {
            date: formatSnoozeTarget(change.until),
          }),
          { action: undo({ action: "unsnooze" }) },
        );
        return;
      case "unarchive":
        toast.success(t("notifications:inbox.toasts.unarchived"));
        return;
      case "unsnooze":
        toast.success(t("notifications:inbox.toasts.unsnoozed"));
        return;
      default:
        return;
    }
  };

  const mutation = useMutation<
    Awaited<ReturnType<typeof updateNotificationState>>,
    Error,
    UpdateNotificationStateInput,
    Context
  >({
    mutationFn: ({ id, change }) => updateNotificationState(id, change),
    onMutate: async ({ id, change }) => {
      await queryClient.cancelQueries({ queryKey: inboxQueryKeys.all() });
      const snapshot = queryClient.getQueriesData({
        queryKey: inboxQueryKeys.all(),
      });
      const now = new Date();
      let before: InboxRowState | undefined;

      for (const [key, data] of queryClient.getQueriesData<
        InfiniteData<InboxPage>
      >({ queryKey: inboxQueryKeys.inboxRoot() })) {
        const filters = filtersOfKey(key);
        if (!filters || !data) continue;
        before ??= data.pages
          .flatMap((page) => page.items)
          .find((row) => row.id === id);
        queryClient.setQueryData(
          key,
          applyActionToPages(data, id, change, filters.view, now),
        );
      }

      if (before) {
        const delta = countDelta(before, change, now);
        for (const [key] of queryClient.getQueriesData<InboxCounts>({
          queryKey: inboxQueryKeys.countsRoot(),
        })) {
          // Rows without a workspace show in every workspace's inbox.
          if (before.workspaceId && key[2] !== before.workspaceId) continue;
          queryClient.setQueryData<InboxCounts>(key, (counts) =>
            applyCountDelta(counts, delta),
          );
        }
      }

      return { snapshot };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error(t("notifications:inbox.toasts.error"));
    },
    onSuccess: (_data, input) => {
      if (!input.silent) notify(input);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all() });
    },
  });

  mutateRef.current = mutation.mutate;

  return mutation;
}

export default useUpdateNotificationState;
