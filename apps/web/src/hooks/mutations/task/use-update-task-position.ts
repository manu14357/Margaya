import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import updateTaskPosition from "@/fetchers/task/update-task-position";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { invalidateAfterStatusChange } from "./use-update-task-status";

export type TaskPlacement = {
  id: string;
  projectId: string;
  position: number;
  /** Only for the task that changes column; a reorder leaves it out. */
  status?: string;
};

/**
 * Places a task after a drag. It sends only the position and, for the card
 * that changed column, the status: the board's copy of every other field may
 * be stale, and writing it back would undo someone else's newer edit.
 */
export function useUpdateTaskPosition() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  // One drop writes many cards; if they all fail, one message is enough.
  const failureToastRef = useRef<string | undefined>(undefined);

  return useMutation({
    mutationFn: ({ id, position, status }: TaskPlacement) =>
      updateTaskPosition(id, { position, status }),
    onSuccess: (_, { id, projectId, status }) => {
      if (status !== undefined) {
        invalidateAfterStatusChange(queryClient, { id, projectId });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["task", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (_, { projectId }) => {
      // The board draws the store's optimistic copy, and a refetch that finds
      // nothing new does not replace it, so the card has to be put back here.
      const saved = queryClient.getQueryData<ProjectWithTasks>([
        "tasks",
        projectId,
      ]);
      const { project, setProject } = useProjectStore.getState();
      if (saved && project?.id === projectId) setProject(saved);
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });

      toast.dismiss(failureToastRef.current);
      failureToastRef.current = toast.error(t("tasks:update.error"));
    },
  });
}
