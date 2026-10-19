import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { toast } from "@/lib/toast";
import { useTaskOpen } from "./use-task-open";

/**
 * After a quick add: refreshes the list and, when the new task is not in
 * it, says so instead of letting it vanish (the view's filters exclude it).
 * Groups with more pages may hold it further down, so then it stays quiet.
 */
export function useCreatedTaskCheck(
  query: Pick<TaskQueryHandle, "refetch">,
  workspaceId: string,
) {
  const { t } = useTranslation();
  const openTask = useTaskOpen(workspaceId);
  // The handle is a fresh object every render; the check stays stable.
  const queryRef = useRef(query);
  queryRef.current = query;
  return useCallback(
    async (task: { id: string; projectId: string }) => {
      const { data } = await queryRef.current.refetch();
      if (!data || data.tasks[task.id]) return;
      const partial =
        data.hasMoreGroups ||
        data.groups.some(
          (group) =>
            group.nextCursor ||
            group.subGroups?.some((cell) => cell.nextCursor),
        );
      if (partial) return;
      toast.info(t("tasks:capture.notInView"), {
        action: {
          label: t("tasks:capture.open"),
          onClick: () => openTask(task),
        },
      });
    },
    [t, openTask],
  );
}
