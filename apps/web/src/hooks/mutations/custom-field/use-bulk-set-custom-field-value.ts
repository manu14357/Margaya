import { useMutation, useQueryClient } from "@tanstack/react-query";
import bulkSetCustomFieldValue from "@/fetchers/custom-field/bulk-set-custom-field-value";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

function useBulkSetCustomFieldValue(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: bulkSetCustomFieldValue,
    onSuccess: () => {
      void invalidateTaskQueries(queryClient, projectId);
      for (const queryKey of [
        ["custom-field-values"],
        ["custom-field-filter-values", projectId],
        ["tasks", projectId],
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export default useBulkSetCustomFieldValue;
