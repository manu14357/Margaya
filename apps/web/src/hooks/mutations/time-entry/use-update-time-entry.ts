import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTimeEntry, {
  type UpdateTimeEntryRequest,
} from "@/fetchers/time-entry/update-time-entry";
import { invalidateTimeEntries } from "./invalidate-time-entries";

function useUpdateTimeEntry(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateTimeEntryRequest) => updateTimeEntry(data),
    onSuccess: () => {
      invalidateTimeEntries(queryClient, [taskId]);
    },
  });
}

export default useUpdateTimeEntry;
