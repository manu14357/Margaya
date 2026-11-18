import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import moveTask from "@/fetchers/task/move-task";
import { scheduleBoardRefresh } from "@/lib/board-cache";
import { toast } from "@/lib/toast";
import { invalidatePlanningProgress } from "./invalidate-planning-progress";

export function useMoveTask() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    meta: { refreshTaskQueries: true },
    mutationFn: moveTask,
    onSuccess: (result, variables) => {
      toast.success(t("tasks:move.success"));
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
      });
      scheduleBoardRefresh(queryClient, result.sourceProjectId);
      scheduleBoardRefresh(queryClient, result.destinationProjectId);
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.taskId],
      });
      // The task leaves one project's cycles, modules and forecasts for the
      // other's.
      for (const projectId of [
        result.sourceProjectId,
        result.destinationProjectId,
      ]) {
        invalidatePlanningProgress(queryClient, projectId);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("tasks:move.error"),
      );
    },
  });
}
