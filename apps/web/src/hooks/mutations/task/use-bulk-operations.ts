import { useMutation, useQueryClient } from "@tanstack/react-query";
import bulkOperation from "@/fetchers/task/bulk-operation";
import deleteTask from "@/fetchers/task/delete-task";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

export function useBulkOperations() {
  const queryClientRef = useQueryClient();

  const invalidateCommon = () => {
    queryClientRef.invalidateQueries({ queryKey: ["tasks"] });
    queryClientRef.invalidateQueries({ queryKey: ["projects"] });
    // Spreadsheets, grouped views and My work read the task query caches.
    void invalidateTaskQueries(queryClientRef);
    // Cycle and module progress, forecasts and risks read status, dates and
    // assignees. The tasks may span projects, so every project's refresh.
    queryClientRef.invalidateQueries({ queryKey: ["cycles"] });
    queryClientRef.invalidateQueries({ queryKey: ["modules"] });
    invalidateDeliveryQueries(queryClientRef);
  };

  const bulkDelete = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await Promise.all(taskIds.map((id) => deleteTask(id)));
    },
    onSuccess: invalidateCommon,
  });

  // Archived tasks keep their column (D7).
  const bulkArchive = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await bulkOperation({ taskIds, operation: "archive" });
    },
    onSuccess: invalidateCommon,
  });

  const bulkUnarchive = useMutation({
    mutationFn: (taskIds: string[]) =>
      bulkOperation({ taskIds, operation: "unarchive" }),
    onSuccess: invalidateCommon,
  });

  const bulkChangeStatus = useMutation({
    mutationFn: async ({
      taskIds,
      status,
    }: {
      taskIds: string[];
      status: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: status,
      });
    },
    onSuccess: invalidateCommon,
  });

  const bulkAssign = useMutation({
    mutationFn: async ({
      taskIds,
      userId,
    }: {
      taskIds: string[];
      userId: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateAssignee",
        value: userId,
      });
    },
    onSuccess: invalidateCommon,
  });

  // Assignee changes also show on subtask and relation rows, open tasks and
  // their activity; only mounted queries refetch.
  const invalidateAssignees = () => {
    invalidateCommon();
    for (const queryKey of [["task-relations"], ["task"], ["activities"]]) {
      queryClientRef.invalidateQueries({ queryKey });
    }
  };

  const bulkAddAssignee = useMutation({
    mutationFn: ({ taskIds, userId }: { taskIds: string[]; userId: string }) =>
      bulkOperation({ taskIds, operation: "addAssignee", value: userId }),
    onSuccess: invalidateAssignees,
  });

  const bulkRemoveAssignee = useMutation({
    mutationFn: ({ taskIds, userId }: { taskIds: string[]; userId: string }) =>
      bulkOperation({ taskIds, operation: "removeAssignee", value: userId }),
    onSuccess: invalidateAssignees,
  });

  const bulkClearAssignees = useMutation({
    mutationFn: (taskIds: string[]) =>
      bulkOperation({ taskIds, operation: "updateAssignee", value: null }),
    onSuccess: invalidateAssignees,
  });

  const bulkMoveToBacklog = useMutation({
    mutationFn: async (taskIds: string[]) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: "planned",
      });
    },
    onSuccess: invalidateCommon,
  });

  const bulkMoveToBoard = useMutation({
    mutationFn: async ({
      taskIds,
      status,
    }: {
      taskIds: string[];
      status: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateStatus",
        value: status,
      });
    },
    onSuccess: invalidateCommon,
  });

  // A move also changes open tasks' keys and activity.
  const bulkMoveToProject = useMutation({
    mutationFn: ({
      taskIds,
      projectId,
    }: {
      taskIds: string[];
      projectId: string;
    }) => bulkOperation({ taskIds, operation: "move", value: projectId }),
    onSuccess: invalidateAssignees,
  });

  const bulkPriority = useMutation({
    mutationFn: async ({
      taskIds,
      priority,
    }: {
      taskIds: string[];
      priority: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updatePriority",
        value: priority,
      });
    },
    onSuccess: invalidateCommon,
  });

  const bulkAddLabel = useMutation({
    mutationFn: async ({
      taskIds,
      labelId,
    }: {
      taskIds: string[];
      labelId: string;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "addLabel",
        value: labelId,
      });
    },
    onSuccess: () => {
      invalidateCommon();
      queryClientRef.invalidateQueries({ queryKey: ["labels"] });
    },
  });

  const bulkRemoveLabel = useMutation({
    mutationFn: ({
      taskIds,
      labelId,
    }: {
      taskIds: string[];
      labelId: string;
    }) => bulkOperation({ taskIds, operation: "removeLabel", value: labelId }),
    onSuccess: () => {
      invalidateCommon();
      queryClientRef.invalidateQueries({ queryKey: ["labels"] });
    },
  });

  const bulkStartDate = useMutation({
    mutationFn: ({
      taskIds,
      startDate,
    }: {
      taskIds: string[];
      startDate: string | null;
    }) =>
      bulkOperation({
        taskIds,
        operation: "updateStartDate",
        value: startDate,
      }),
    onSuccess: invalidateCommon,
  });

  const bulkDueDate = useMutation({
    mutationFn: async ({
      taskIds,
      dueDate,
    }: {
      taskIds: string[];
      dueDate: string | null;
    }) => {
      await bulkOperation({
        taskIds,
        operation: "updateDueDate",
        value: dueDate,
      });
    },
    onSuccess: invalidateCommon,
  });

  return {
    bulkDelete: bulkDelete.mutateAsync,
    bulkArchive: bulkArchive.mutateAsync,
    bulkUnarchive: bulkUnarchive.mutateAsync,
    bulkChangeStatus: bulkChangeStatus.mutateAsync,
    bulkAssign: bulkAssign.mutateAsync,
    bulkAddAssignee: bulkAddAssignee.mutateAsync,
    bulkRemoveAssignee: bulkRemoveAssignee.mutateAsync,
    bulkClearAssignees: bulkClearAssignees.mutateAsync,
    bulkMoveToBacklog: bulkMoveToBacklog.mutateAsync,
    bulkMoveToBoard: bulkMoveToBoard.mutateAsync,
    bulkMoveToProject: bulkMoveToProject.mutateAsync,
    bulkPriority: bulkPriority.mutateAsync,
    bulkAddLabel: bulkAddLabel.mutateAsync,
    bulkRemoveLabel: bulkRemoveLabel.mutateAsync,
    bulkDueDate: bulkDueDate.mutateAsync,
    bulkStartDate: bulkStartDate.mutateAsync,
  };
}
