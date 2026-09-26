import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateColumn, {
  type UpdateColumnData,
} from "@/fetchers/column/update-column";

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
        ...(variables.data.group !== undefined ||
        variables.data.isFinal !== undefined
          ? [queryClient.invalidateQueries({ queryKey: ["projects"] })]
          : []),
      ]);
    },
  });
}
