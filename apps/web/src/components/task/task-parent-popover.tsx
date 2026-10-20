import { type ReactElement, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useSetTaskParent from "@/hooks/mutations/task-relation/use-set-task-parent";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatTaskKey } from "@/lib/task-key";
import { oldestParent, parentCandidates } from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import ParentTaskOptions, {
  type ParentOption,
  type ProjectBoardTask,
} from "./parent-task-options";

type TaskParentPopoverProps = {
  task: { id: string; projectId: string };
  children: ReactElement;
};

/**
 * Sets, changes or clears the task's parent, a task of the same project.
 * Without task:update it only shows the trigger.
 */
export default function TaskParentPopover({
  task,
  children,
}: TaskParentPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { canUpdateTasks } = useWorkspacePermission();
  const { data: relations = [] } = useGetTaskRelations(task.id);
  const setParent = useSetTaskParent();

  const parent = oldestParent(relations, task.id)?.sourceTask ?? null;
  const current: ParentOption | null = parent
    ? {
        id: parent.id,
        key: formatTaskKey(parent.projectSlug, parent.number),
        title: parent.title,
        group: parent.group,
      }
    : null;
  // Not itself, its own sub-tasks or its current parent (listed apart).
  const candidates = useCallback(
    (tasks: ProjectBoardTask[]) => parentCandidates(tasks, relations, task.id),
    [relations, task.id],
  );

  if (!canUpdateTasks()) return children;

  const choose = (next: ParentOption | null) => {
    setOpen(false);
    const parentTaskId = next?.id ?? null;
    if (parentTaskId === (parent?.id ?? null)) return;
    setParent.mutate(
      { taskId: task.id, parentTaskId, projectId: task.projectId },
      {
        onSuccess: () => {
          toast.success(
            next
              ? t("tasks:parent.toast.set", { key: next.key })
              : t("tasks:parent.toast.removed"),
          );
        },
        onError: (error) => {
          toast.error(error.message || t("tasks:parent.toast.error"));
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        {open && (
          <ParentTaskOptions
            projectId={task.projectId}
            current={current}
            candidates={candidates}
            onChoose={choose}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
