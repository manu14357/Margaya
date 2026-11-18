import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SetCustomFieldValueRequest } from "@/fetchers/custom-field/set-custom-field-value";
import setCustomFieldValue from "@/fetchers/custom-field/set-custom-field-value";
import { scheduleBoardRefresh } from "@/lib/board-cache";

type SetCustomFieldValueArgs = SetCustomFieldValueRequest & {
  projectId?: string;
};

function useSetCustomFieldValue() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { refreshTaskQueries: true },
    mutationFn: ({ taskId, fieldId, value }: SetCustomFieldValueArgs) =>
      setCustomFieldValue({ taskId, fieldId, value }),
    onSuccess: (_data, variables: SetCustomFieldValueArgs) => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-field-values"],
      });
      if (variables.projectId) {
        scheduleBoardRefresh(queryClient, variables.projectId);
        void queryClient.invalidateQueries({
          queryKey: ["custom-field-filter-values", variables.projectId],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
      });
    },
  });
}

export default useSetCustomFieldValue;
