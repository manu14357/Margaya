import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteColumn from "@/fetchers/column/delete-column";

export function useDeleteColumn() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { refreshTaskQueries: true },
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteColumn(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ refetchType: "all" });
    },
  });
}
