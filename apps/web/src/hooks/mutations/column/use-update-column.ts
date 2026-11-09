import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateColumn, {
  type UpdateColumnData,
} from "@/fetchers/column/update-column";
import { invalidatePlanningProgress } from "@/hooks/mutations/task/invalidate-planning-progress";

export function useUpdateColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      projectId: string;
      data: UpdateColumnData;
    }) => updateColumn(id, data),
    onSuccess: async (_, variables) => {
      const regrouped =
        variables.data.group !== undefined ||
        variables.data.isFinal !== undefined;
      // A group decides which tasks are open or done: cycle and module
      // progress, forecasts and risks.
      if (regrouped) {
        invalidatePlanningProgress(queryClient, variables.projectId);
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["columns", variables.projectId],
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: ["tasks", variables.projectId],
          refetchType: "all",
        }),
        // A group change moves project statistics (completion, due date).
        ...(regrouped
          ? [queryClient.invalidateQueries({ queryKey: ["projects"] })]
          : []),
      ]);
    },
  });
}
