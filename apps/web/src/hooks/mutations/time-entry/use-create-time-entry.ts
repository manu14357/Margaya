import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTimeEntry, {
  type CreateTimeEntryRequest,
} from "@/fetchers/time-entry/create-time-entry";
import { invalidateTimeEntries } from "./invalidate-time-entries";

function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTimeEntryRequest) => createTimeEntry(data),
    onSuccess: (created, variables) => {
      // Starting a timer stops any other, which may be on another task.
      invalidateTimeEntries(queryClient, [
        variables.taskId,
        ...created.stoppedEntries.map((entry) => entry.taskId),
      ]);
    },
  });
}

export default useCreateTimeEntry;
