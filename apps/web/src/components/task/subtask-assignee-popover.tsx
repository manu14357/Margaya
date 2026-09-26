import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  embeddedAssignees,
  maxAssigneeCount,
  sharedAssignees,
} from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import AssigneeMultiSelect from "./assignee-multi-select";

type SubtaskAssigneePopoverProps = {
  tasks: Task[];
  workspaceId: string;
  children: React.ReactNode;
};

/**
 * Assignees of the selected subtasks (one or many). A check means everyone
 * selected has that person, a dash only some; each click is one request
 * across all of them.
 */
export default function SubtaskAssigneePopover({
  tasks,
  workspaceId,
  children,
}: SubtaskAssigneePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { bulkAddAssignee, bulkRemoveAssignee, bulkClearAssignees } =
    useBulkOperations();
  const { canAssignTasks } = useWorkspacePermission();
  const { all, some } = sharedAssignees(tasks);
  const taskIds = tasks.map((task) => task.id);

  const run = async (
    userIds: readonly string[],
    save: () => Promise<unknown>,
  ) => {
    const mark = (pending: boolean) =>
      setPendingIds((current) => {
        const next = new Set(current);
        for (const id of userIds) {
          if (pending) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    mark(true);
    try {
      await save();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:assignees.updateError"),
      );
    } finally {
      mark(false);
    }
  };

  const handleToggle = (userId: string, nextChecked: boolean) =>
    void run([userId], () =>
      nextChecked
        ? bulkAddAssignee({ taskIds, userId })
        : bulkRemoveAssignee({ taskIds, userId }),
    );

  const handleClear = () =>
    void run([...all, ...some], () => bulkClearAssignees(taskIds));

  if (!canAssignTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <AssigneeMultiSelect
          workspaceId={workspaceId}
          selectedIds={all}
          mixedIds={some}
          pendingIds={pendingIds}
          embedded={tasks.flatMap(embeddedAssignees)}
          onToggle={handleToggle}
          onClear={handleClear}
          assignedCount={maxAssigneeCount(tasks)}
        />
      </PopoverContent>
    </Popover>
  );
}
