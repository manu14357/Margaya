import { useMutation, useQueryClient } from "@tanstack/react-query";
import createIntakeItem from "@/fetchers/intake/create-intake-item";
import type { CreateIntakeRequest } from "@/types/intake";
import { invalidateIntakeQueries } from "./invalidate-intake-queries";

export function useCreateIntakeItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      ...json
    }: CreateIntakeRequest & { projectId: string }) =>
      createIntakeItem(projectId, json),
    onSuccess: (item) => {
      invalidateIntakeQueries(queryClient, { projectId: item.projectId });
    },
  });
}

export default useCreateIntakeItem;
