import { useMutation, useQueryClient } from "@tanstack/react-query";
import stopTimeEntry from "@/fetchers/time-entry/stop-time-entry";
import { invalidateTimeEntries } from "./invalidate-time-entries";

function useStopTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; taskId: string }) => stopTimeEntry(id),
    onSuccess: (_, variables) => {
      invalidateTimeEntries(queryClient, [variables.taskId]);
    },
  });
}

export default useStopTimeEntry;
