import { useTranslation } from "react-i18next";
import { PublicTaskLabels } from "@/components/public-project/public-task-labels";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";
import { getPriorityIcon } from "@/lib/priority";
import type { PublicBoard, PublicTaskRow } from "@/types/public-board";
import {
  PublicDueDate,
  PublicTaskChips,
  rowAssignees,
  rowLabels,
} from "./public-task-meta";

type PublicTaskCardProps = {
  row: PublicTaskRow;
  board: PublicBoard["board"];
  /** The column's group; it colours the card's leading edge. */
  group?: string | null;
  isCompleted: boolean;
  onOpen: (number: number) => void;
};

/**
 * A board card: a status-coloured edge, the key and assignees on one line,
 * a clamped title and labels, then a borderless footer with priority, due
 * date and the count chips.
 */
export default function PublicTaskCard({
  row,
  board,
  group,
  isCompleted,
  onOpen,
}: PublicTaskCardProps) {
  const { t } = useTranslation();
  const assignees = board.showAssignees ? rowAssignees(row) : [];
  const labels = rowLabels(row);
  const edge = isColumnGroup(group)
    ? COLUMN_GROUP_META[group].barClassName
    : "bg-border";

  return (
    <button
      type="button"
      className="group relative w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-card py-2 pr-2.5 pl-3 text-left shadow-xs/5 transition-[border-color,box-shadow] duration-150 ease-out hover:border-ring/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => row.number !== null && onOpen(row.number)}
      aria-label={t("publicProject:taskCard.viewDetailsAria", {
        title: row.title,
      })}
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-0.5", edge)}
      />
      <span className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {row.key}
        </span>
        {assignees.length > 0 && (
          <span className="ml-auto">
            <AssigneeAvatarStack assignees={assignees} max={3} size="xs" />
          </span>
        )}
      </span>

      <span className="line-clamp-3 break-words font-medium text-foreground text-sm leading-snug">
        {row.title}
      </span>

      {labels.length > 0 && (
        <span className="mt-1.5 block">
          <PublicTaskLabels labels={labels} />
        </span>
      )}

      <span className="mt-2 flex flex-wrap items-center gap-1.5 empty:hidden">
        {row.priority && row.priority !== "no-priority" && (
          <span className="inline-flex items-center">
            {getPriorityIcon(row.priority)}
          </span>
        )}
        <PublicDueDate dueDate={row.dueDate} isCompleted={isCompleted} />
        <PublicTaskChips row={row} board={board} className="ml-auto" />
      </span>
    </button>
  );
}
