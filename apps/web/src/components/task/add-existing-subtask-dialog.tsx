import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSetTaskParent from "@/hooks/mutations/task-relation/use-set-task-parent";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { formatTaskKey } from "@/lib/task-key";
import {
  ancestorIds,
  boardTaskList,
  matchesTaskQuery,
  type RelationLike,
  subtaskCandidates,
} from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import TaskPickerDialog, { type PickerTask } from "./task-picker-dialog";

type AddExistingSubtaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  projectId: string;
};

/**
 * Makes an existing task of the project a sub-task of this one, moving it
 * from its current parent. Ancestors known from cached relations are left
 * out; the server refuses the rest.
 */
export default function AddExistingSubtaskDialog({
  open,
  onOpenChange,
  taskId,
  projectId,
}: AddExistingSubtaskDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const { data: board } = useGetTasks(projectId);
  const { data: relations = [] } = useGetTaskRelations(taskId);
  const setParent = useSetTaskParent();

  const items = useMemo(() => {
    const ancestors = ancestorIds(taskId, (id) =>
      id === taskId
        ? relations
        : queryClient.getQueryData<RelationLike[]>(["task-relations", id]),
    );
    const slug = board?.slug ?? "";
    const columns = new Map(
      (board?.columns ?? []).map((column) => [column.id, column]),
    );
    return subtaskCandidates(boardTaskList(board), relations, taskId, ancestors)
      .map((task): PickerTask => {
        const key = formatTaskKey(slug, task.number);
        const column = columns.get(task.status);
        return {
          id: task.id,
          key,
          title: task.title,
          projectId,
          label: `${key} ${task.title}`,
          status: task.status,
          column: column && {
            icon: column.icon,
            isFinal: column.isFinal,
            group: column.group,
          },
        };
      })
      .filter((item) => matchesTaskQuery(query, item.key, item.title));
  }, [board, projectId, query, queryClient, relations, taskId]);

  const handlePick = (item: PickerTask) => {
    setParent.mutate(
      { taskId: item.id, parentTaskId: taskId, projectId: item.projectId },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("tasks:subtasks.addedExisting", { key: item.key }));
        },
        onError: (error) =>
          toast.error(error.message || t("tasks:parent.toast.error")),
      },
    );
  };

  return (
    <TaskPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      placeholder={t("tasks:parent.search")}
      groups={[
        {
          value: "this-project",
          label: t("tasks:relations.tasksInProject"),
          items,
        },
      ]}
      onPick={handlePick}
      footer={
        <span className="text-muted-foreground/60">
          {t("tasks:subtasks.addExistingTitle")}
        </span>
      }
    />
  );
}
