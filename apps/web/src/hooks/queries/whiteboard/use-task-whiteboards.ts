import { useQuery } from "@tanstack/react-query";
import listTaskWhiteboards from "@/fetchers/whiteboard/list-task-whiteboards";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/** Visible boards that hold a card for the task. */
export function useTaskWhiteboards(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: whiteboardQueryKeys.taskBoard(taskId),
    queryFn: () => listTaskWhiteboards(taskId),
    enabled: Boolean(taskId) && enabled,
  });
}
