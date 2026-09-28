import { useQuery } from "@tanstack/react-query";
import getTaskAttachments from "@/fetchers/task-attachment/get-task-attachments";

export const taskAttachmentsQueryKey = (taskId: string) =>
  ["task-attachments", taskId] as const;

/** Files attached through the task's Attachments panel, newest first. */
function useGetTaskAttachments(taskId: string) {
  return useQuery({
    queryKey: taskAttachmentsQueryKey(taskId),
    queryFn: () => getTaskAttachments(taskId),
    enabled: Boolean(taskId),
  });
}

export default useGetTaskAttachments;
