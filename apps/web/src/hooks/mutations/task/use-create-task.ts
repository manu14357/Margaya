import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTask, {
  type CreateTaskRequest,
} from "@/fetchers/task/create-task";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      title,
      description,
      assigneeIds,
      projectId,
      status,
      startDate,
      dueDate,
      priority,
      customFields,
      parentId,
      isMilestone,
    }: CreateTaskRequest) =>
      createTask(
        title,
        description,
        projectId,
        assigneeIds,
        status,
        startDate ? new Date(startDate) : undefined,
        dueDate ? new Date(dueDate) : undefined,
        priority,
        customFields,
        parentId,
        isMilestone,
      ),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["custom-field-values", variables.projectId],
      });
      // The project's forecast counts its open tasks.
      invalidateDeliveryQueries(queryClient, variables.projectId);
      if (variables.parentId) {
        // The parent's sub-task list, both tasks' history and the timeline's
        // relation lines, as linking them separately would refresh.
        for (const taskId of [variables.parentId, data.id]) {
          void queryClient.invalidateQueries({
            queryKey: ["task-relations", taskId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["activities", taskId],
          });
        }
        void queryClient.invalidateQueries({
          queryKey: ["task-relations", "project"],
        });
        void invalidateTaskQueries(queryClient, variables.projectId);
      }
    },
  });
}

export default useCreateTask;
