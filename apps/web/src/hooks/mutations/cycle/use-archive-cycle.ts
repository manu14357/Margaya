import { useMutation, useQueryClient } from "@tanstack/react-query";
import { archiveCycle, unarchiveCycle } from "@/fetchers/cycle/archive-cycle";
import { invalidateCycleQueries } from "./invalidate-cycle-queries";

/** Archives a completed cycle (`archive: true`) or restores an archived one. */
export function useArchiveCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cycleId,
      archive,
    }: {
      cycleId: string;
      projectId: string;
      archive: boolean;
    }) => (archive ? archiveCycle(cycleId) : unarchiveCycle(cycleId)),
    onSuccess: (_cycle, { projectId }) => {
      invalidateCycleQueries(queryClient, projectId, { favorites: true });
    },
  });
}

export default useArchiveCycle;
