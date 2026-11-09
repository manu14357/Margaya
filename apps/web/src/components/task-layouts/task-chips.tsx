import {
  Archive,
  Boxes,
  Calendar,
  CalendarClock,
  CalendarX,
  IterationCw,
  ListTree,
  Ruler,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LabelChips } from "@/components/shared/label-chips";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { formatEstimateValue } from "@/lib/estimate/format";
import { formatDateShort } from "@/lib/format";
import type { DisplayProperties } from "@/lib/task-query/model";
import { isRowCompleted } from "@/lib/task-query/row-task";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";

const chipClassName =
  "inline-flex h-5.5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 py-1 font-medium text-[10px] text-muted-foreground";

/** A due date chip colored by lateness; finished tasks are never late. */
export function DueDateChip({ row }: { row: TaskQueryRow }) {
  if (!row.dueDate) return null;
  const status = getDueDateStatus(row.dueDate, isRowCompleted(row));
  const Icon =
    status === "overdue"
      ? CalendarX
      : status === "due-soon"
        ? CalendarClock
        : Calendar;
  return (
    <span
      className={cn(
        "flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 py-1 font-medium text-[10px]",
        dueDateStatusColors[status],
      )}
    >
      <Icon className="size-3" />
      <span>{formatDateShort(new Date(row.dueDate))}</span>
    </span>
  );
}

/** Property chips of a task query row: labels, planning, counts. */
export default function TaskChips({
  row,
  meta,
  properties,
  showDueDate = true,
}: {
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  properties: DisplayProperties;
  showDueDate?: boolean;
}) {
  const { t } = useTranslation();
  const cycle = row.cycleId
    ? meta.cycles.find((candidate) => candidate.id === row.cycleId)
    : undefined;
  const modules = (row.moduleIds ?? []).flatMap((id) => {
    const module = meta.modules.find((candidate) => candidate.id === id);
    return module ? [module] : [];
  });
  const point = row.estimatePointId
    ? meta.estimatePoints.find(
        (candidate) => candidate.id === row.estimatePointId,
      )
    : undefined;

  return (
    <>
      {properties.labels && row.labels && row.labels.length > 0 && (
        <LabelChips
          labels={row.labels.map((label) => ({
            id: label.name,
            name: label.name,
            color: label.color,
          }))}
          max={3}
        />
      )}
      {properties.cycle && cycle && (
        <span className={chipClassName} title={cycle.name}>
          <IterationCw className="size-3" />
          <span className="max-w-24 truncate">{cycle.name}</span>
        </span>
      )}
      {properties.modules && modules.length > 0 && (
        <span
          className={chipClassName}
          title={modules.map((module) => module.name).join(", ")}
        >
          <Boxes className="size-3" />
          <span className="max-w-24 truncate">
            {modules.length === 1
              ? modules[0]?.name
              : t("tasks:groups.moduleCount", { count: modules.length })}
          </span>
        </span>
      )}
      {properties.estimate && point && (
        <span className={chipClassName}>
          <Ruler className="size-3" />
          {formatEstimateValue(point.type, point.value)}
        </span>
      )}
      {properties.subTaskCount && (row.subTaskCount ?? 0) > 0 && (
        <span className={chipClassName}>
          <ListTree className="size-3" />
          {row.subTaskCount}
        </span>
      )}
      {row.archivedAt && (
        <span className={chipClassName}>
          <Archive className="size-3" />
          {t("tasks:archive.badge")}
        </span>
      )}
      {showDueDate && properties.dueDate && <DueDateChip row={row} />}
    </>
  );
}
