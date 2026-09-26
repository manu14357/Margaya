import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSetTaskAssignees } from "@/hooks/mutations/task/use-set-task-assignees";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { assigneesOfTask, embeddedAssignees } from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import AssigneeMultiSelect from "./assignee-multi-select";

type TaskAssigneePopoverProps = {
  task: Task;
  workspaceId: string;
  children: React.ReactNode;
};

/**
 * Picks a task's assignees. The popover stays open while people are toggled;
 * each toggle saves at once, and only that person's row waits for it.
 */
export default function TaskAssigneePopover({
  task,
  workspaceId,
  children,
}: TaskAssigneePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { mutateAsync: updateAssignees } = useUpdateTaskAssignees();
  const { mutateAsync: setAssignees } = useSetTaskAssignees();
  const { canAssignTasks } = useWorkspacePermission();
  const selectedIds = assigneesOfTask(task);
  const target = { taskId: task.id, projectId: task.projectId, workspaceId };

  const markPending = (userIds: readonly string[], pending: boolean) =>
    setPendingIds((current) => {
      const next = new Set(current);
      for (const id of userIds) {
        if (pending) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const run = async (
    userIds: readonly string[],
    save: () => Promise<unknown>,
  ) => {
    markPending(userIds, true);
    try {
      await save();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:assignees.updateError"),
      );
    } finally {
      markPending(userIds, false);
    }
  };

  const handleToggle = (userId: string, nextChecked: boolean) =>
    void run([userId], () =>
      updateAssignees({
        ...target,
        ...(nextChecked ? { add: [userId] } : { remove: [userId] }),
      }),
    );

  const handleClear = () =>
    void run(selectedIds, () => setAssignees({ ...target, assigneeIds: [] }));

  // Without the assign permission the trigger stays a plain display.
  if (!canAssignTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <AssigneeMultiSelect
          workspaceId={workspaceId}
          selectedIds={selectedIds}
          pendingIds={pendingIds}
          embedded={embeddedAssignees(task)}
          onToggle={handleToggle}
          onClear={handleClear}
        />
      </PopoverContent>
    </Popover>
  );
}
