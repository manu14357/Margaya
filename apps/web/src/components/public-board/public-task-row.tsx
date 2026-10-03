import { useTranslation } from "react-i18next";
import { PublicTaskLabels } from "@/components/public-project/public-task-labels";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { getPriorityIcon } from "@/lib/priority";
import type { PublicBoard, PublicTaskRow as Row } from "@/types/public-board";
import {
  PublicDueDate,
  PublicTaskChips,
  rowAssignees,
  rowLabels,
} from "./public-task-meta";

type PublicTaskRowProps = {
  row: Row;
  board: PublicBoard["board"];
  isCompleted: boolean;
  onOpen: (number: number) => void;
};

/**
 * A compact list row: priority, key and title, then labels, the count
 * chips, assignees and the due date on the right. Small screens keep the
 * key, title and due date.
 */
export default function PublicTaskRow({
  row,
  board,
  isCompleted,
  onOpen,
}: PublicTaskRowProps) {
  const { t } = useTranslation();
  const assignees = board.showAssignees ? rowAssignees(row) : [];
  const labels = rowLabels(row);

  return (
    <button
      type="button"
      className="group flex min-h-9 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => row.number !== null && onOpen(row.number)}
      aria-label={t("publicProject:taskCard.viewDetailsAria", {
        title: row.title,
      })}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {row.priority &&
          row.priority !== "no-priority" &&
          getPriorityIcon(row.priority)}
      </span>
      <span className="w-16 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
        {row.key}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
        {row.title}
      </span>
      {labels.length > 0 && (
        <span className="max-w-64 shrink-0 overflow-hidden max-lg:hidden">
          <PublicTaskLabels labels={labels} />
        </span>
      )}
      <PublicTaskChips
        row={row}
        board={board}
        className="shrink-0 flex-nowrap max-sm:hidden"
      />
      {assignees.length > 0 && (
        <span className="shrink-0 max-sm:hidden">
          <AssigneeAvatarStack assignees={assignees} max={2} size="xs" />
        </span>
      )}
      <span className="shrink-0">
        <PublicDueDate dueDate={row.dueDate} isCompleted={isCompleted} />
      </span>
    </button>
  );
}
