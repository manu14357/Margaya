import { useMutation, useQueryClient } from "@tanstack/react-query";
import setTaskCycle from "@/fetchers/cycle/set-task-cycle";
import setTaskModules from "@/fetchers/module/set-task-modules";
import bulkOperation from "@/fetchers/task/bulk-operation";
import updateTaskPriority from "@/fetchers/task/update-task-priority";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import { invalidateTaskQueries } from "@/lib/task-query/cache";
import type { GroupMoveAction } from "@/lib/task-query/group-moves";
import type Task from "@/types/task";

type MoveVariables = {
  task: Task;
  action: GroupMoveAction;
};

/** The requests one drop makes (exported for tests). */
export async function runGroupMove({ task, action }: MoveVariables) {
  switch (action.kind) {
    case "status":
      await updateTaskStatus(task.id, { status: action.status });
      return;
    case "priority":
      await updateTaskPriority(task.id, { ...task, priority: action.priority });
      return;
    case "assignee":
      // Dropping on "No assignee" clears every assignee.
      if (!action.add) {
        await bulkOperation({
          taskIds: [task.id],
          operation: "updateAssignee",
          value: null,
        });
        return;
      }
      if (action.remove) {
        await bulkOperation({
          taskIds: [task.id],
          operation: "removeAssignee",
          value: action.remove,
        });
      }
      await bulkOperation({
        taskIds: [task.id],
        operation: "addAssignee",
        value: action.add,
      });
      return;
    case "label":
      if (action.removeLabelId) {
        await bulkOperation({
          taskIds: [task.id],
          operation: "removeLabel",
          value: action.removeLabelId,
        });
      }
      if (action.addLabelId) {
        await bulkOperation({
          taskIds: [task.id],
          operation: "addLabel",
          value: action.addLabelId,
        });
      }
      return;
    case "cycle":
      await setTaskCycle(task.id, action.cycleId);
      return;
    case "module":
      await setTaskModules(task.id, {
        ...(action.add ? { addModuleIds: [action.add] } : {}),
        ...(action.remove ? { removeModuleIds: [action.remove] } : {}),
      });
      return;
  }
}

/** Applies a query-mode board drop: changes the grouped property. */
export function useMoveTaskToGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runGroupMove,
    onSettled: (_data, _error, { task }) => {
      void invalidateTaskQueries(queryClient, task.projectId);
      for (const queryKey of [
        ["tasks", task.projectId],
        ["task", task.id],
        ["activities", task.id],
        ["labels", task.id],
        ["cycles", task.projectId],
        ["modules", task.projectId],
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export default useMoveTaskToGroup;
