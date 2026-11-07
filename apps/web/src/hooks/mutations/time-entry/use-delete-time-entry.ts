import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTimeEntry from "@/fetchers/time-entry/delete-time-entry";
import { invalidateTimeEntries } from "./invalidate-time-entries";

function useDeleteTimeEntry(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTimeEntry(id),
    onSuccess: () => {
      invalidateTimeEntries(queryClient, [taskId]);
    },
  });
}

export default useDeleteTimeEntry;
