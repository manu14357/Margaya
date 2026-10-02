import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import TaskPickerDialog, {
  type PickerTask,
} from "@/components/task/task-picker-dialog";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { formatIntakeKey } from "@/lib/intake";
import { formatTaskKey } from "@/lib/task-key";
import { boardTaskList, matchesTaskQuery } from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import type { IntakeItem } from "@/types/intake";

type DuplicateIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IntakeItem;
  onMarked?: (item: IntakeItem) => void;
};

/**
 * Marks the request a duplicate of a task on the project's board or
 * backlog. The board payload never holds triage tasks, and the request's
 * own task is left out.
 */
export default function DuplicateIntakeDialog({
  open,
  onOpenChange,
  item,
  onMarked,
}: DuplicateIntakeDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: board, isLoading } = useGetTasks(open ? item.projectId : "");
  const triage = useTriageIntakeItem();

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const candidates = useMemo(() => {
    const slug = board?.slug ?? "";
    const columns = new Map(
      (board?.columns ?? []).map((column) => [column.id, column]),
    );
    return boardTaskList(board)
      .filter((task) => task.id !== item.taskId)
      .map((task): PickerTask => {
        const key = formatTaskKey(slug, task.number);
        const column = columns.get(task.status);
        return {
          id: task.id,
          key,
          title: task.title,
          projectId: item.projectId,
          label: `${key} ${task.title}`,
          status: task.status,
          column: column && {
            icon: column.icon,
            isFinal: column.isFinal,
            group: column.group,
          },
        };
      });
  }, [board, item.projectId, item.taskId]);

  const items = candidates.filter((task) =>
    matchesTaskQuery(query, task.key, task.title),
  );

  const handlePick = (task: PickerTask) => {
    if (triage.isPending) return;
    triage.mutate(
      {
        id: item.id,
        projectId: item.projectId,
        action: "duplicate",
        duplicateOfTaskId: task.id,
      },
      {
        onSuccess: (marked) => {
          onOpenChange(false);
          onMarked?.(marked);
          toast.success(t("intake:duplicate.toast", { key: task.key }));
        },
        onError: (error) =>
          toast.error(error.message || t("intake:duplicate.error")),
      },
    );
  };

  const status = isLoading
    ? t("common:empty.loading")
    : candidates.length === 0
      ? t("intake:duplicate.noTasks")
      : items.length === 0
        ? t("intake:duplicate.empty")
        : undefined;

  return (
    <TaskPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      placeholder={t("intake:duplicate.searchPlaceholder")}
      groups={[
        {
          value: "project",
          label: t("intake:duplicate.title", {
            key: formatIntakeKey(item.task.key),
          }),
          items,
        },
      ]}
      onPick={handlePick}
      status={status}
      footer={
        <span className="text-muted-foreground/60">
          {t("intake:duplicate.description")}
        </span>
      }
    />
  );
}
