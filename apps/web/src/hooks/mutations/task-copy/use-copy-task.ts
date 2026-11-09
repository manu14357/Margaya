import { useMutation, useQueryClient } from "@tanstack/react-query";
import copyTask, { type CopyOption } from "@/fetchers/task-copy/copy-task";
import { invalidatePlanningProgress } from "@/hooks/mutations/task/invalidate-planning-progress";

type Variables = {
  taskId: string;
  /** The destination project (the source's own when copying in place). */
  projectId: string;
  title: string;
  include: CopyOption[];
  /** The source's parent, whose sub-task list gains the copy. */
  parentTaskId?: string | null;
};

function useCopyTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, projectId, title, include }: Variables) =>
      copyTask({ taskId, body: { projectId, title, include } }),
    onSuccess: (result, { taskId, projectId, include, parentTaskId }) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      // The copy counts in the project's forecast, and with its planning
      // in the cycle's and modules' progress.
      invalidatePlanningProgress(queryClient, projectId);
      const parentCopied =
        parentTaskId &&
        include.includes("parent") &&
        !result.skipped.includes("parent");
      if (parentCopied) {
        queryClient.invalidateQueries({
          queryKey: ["task-relations", parentTaskId],
        });
      }
    },
  });
}

export default useCopyTask;
