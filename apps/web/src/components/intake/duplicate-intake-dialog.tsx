import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import TaskPickerDialog, {
  type PickerTask,
} from "@/components/task/task-picker-dialog";
import { checkDuplicatesWithAi } from "@/fetchers/ai/build";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
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
  /** The request's description, for the AI duplicate check. */
  description?: string;
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
  description,
  onMarked,
}: DuplicateIntakeDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { data: board, isLoading } = useGetTasks(open ? item.projectId : "");
  const triage = useTriageIntakeItem();
  const { available: aiAvailable } = useAiAvailability(item.projectId);
  const aiCheck = useMutation({ mutationFn: checkDuplicatesWithAi });
  const aiCheckRef = useRef(aiCheck);
  aiCheckRef.current = aiCheck;

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // AI suggestions on open: the request's text against the project's tasks,
  // re-ranked by the duplicate check. Picking one marks the duplicate.
  useEffect(() => {
    if (!open || !aiAvailable) return;
    const title = item.task.title.trim().slice(0, 255);
    if (!title) return;
    aiCheckRef.current.mutate({
      projectId: item.projectId,
      title,
      ...(description?.trim()
        ? { description: description.trim().slice(0, 4000) }
        : {}),
    });
  }, [open, aiAvailable, item.projectId, item.task.title, description]);

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

  const suggested = useMemo(() => {
    if (!open) return [];
    const byId = new Map(candidates.map((task) => [task.id, task]));
    return (aiCheck.data?.tasks ?? [])
      .filter((task) => task.id !== item.taskId)
      .map((task): PickerTask => {
        const known = byId.get(task.id);
        const verdict = t(`ai:duplicates.verdict.${task.verdict}`);
        return {
          ...(known ?? {
            id: task.id,
            key: task.key,
            title: task.title,
            projectId: item.projectId,
            status: task.status,
          }),
          label: `${task.key} ${task.title}`,
          hint: task.reason ? `${verdict}: ${task.reason}` : verdict,
        };
      })
      .filter((task) => matchesTaskQuery(query, task.key, task.title));
  }, [aiCheck.data, candidates, item.projectId, item.taskId, open, query, t]);

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
          value: "ai",
          label: t("intake:duplicate.aiSuggestions"),
          items: suggested,
        },
        {
          value: "project",
          label: t("intake:duplicate.title", {
            key: formatIntakeKey(item.task.key),
          }),
          items,
        },
      ]}
      onPick={handlePick}
      status={
        status ??
        (aiCheck.isPending ? t("intake:duplicate.aiChecking") : undefined)
      }
      footer={
        <span className="text-muted-foreground/60">
          {t("intake:duplicate.description")}
        </span>
      }
    />
  );
}
