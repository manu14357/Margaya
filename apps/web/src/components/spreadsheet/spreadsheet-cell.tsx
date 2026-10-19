import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LabelChips } from "@/components/shared/label-chips";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import TaskDueDatePopover from "@/components/task/task-due-date-popover";
import TaskLabelsPopover from "@/components/task/task-labels-popover";
import TaskPriorityPopover from "@/components/task/task-priority-popover";
import TaskStartDatePopover from "@/components/task/task-start-date-popover";
import TaskStatusPopover from "@/components/task/task-status-popover";
import { DueDateChip } from "@/components/task-layouts/task-chips";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { formatEstimateValue } from "@/lib/estimate/format";
import { formatDateShort, formatRelativeTime } from "@/lib/format";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { columnOfRow, rowToTask } from "@/lib/task-query/row-task";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import type { SpreadsheetColumn } from "./columns";
import {
  SpreadsheetCycleEditor,
  SpreadsheetEstimateEditor,
  SpreadsheetModulesEditor,
} from "./planning-cells";

type CellProps = {
  column: SpreadsheetColumn;
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  workspaceId: string;
  canEdit: boolean;
  canAssign: boolean;
};

const cellButtonClass =
  "h-8 w-full min-w-0 justify-start gap-1.5 rounded-none px-2 font-normal text-sm";

function CellButton({
  children,
  ...props
}: { children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="sm" className={cellButtonClass} {...props}>
      {children}
    </Button>
  );
}

function Plain({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-1.5 px-2 text-sm">
      {children}
    </div>
  );
}

/**
 * Mounts a picker only once its cell is used, then opens it: a sheet of
 * rows would otherwise mount hundreds of pickers (some fetch per task).
 */
export function LazyEditor({
  display,
  editable,
  renderEditor,
}: {
  display: ReactNode;
  editable: boolean;
  renderEditor: (trigger: ReactElement) => ReactNode;
}) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.querySelector("button")?.click();
  }, [active]);

  if (!editable) return <Plain>{display}</Plain>;
  if (!active) {
    return <CellButton onClick={() => setActive(true)}>{display}</CellButton>;
  }
  return (
    <div ref={ref}>{renderEditor(<CellButton>{display}</CellButton>)}</div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="truncate text-muted-foreground">{children}</span>;
}

/** One property of one row, editable in place (B4 §6.5). */
export default function SpreadsheetCell({
  column,
  row,
  meta,
  workspaceId,
  canEdit,
  canAssign,
}: CellProps) {
  const { t } = useTranslation();
  const project = meta.projects.find(
    (candidate) => candidate.id === row.projectId,
  );
  const task = () => rowToTask(row, meta);

  switch (column.property) {
    case "status": {
      const statusColumn = columnOfRow(row, meta);
      const display = (
        <>
          {row.status === "planned"
            ? getColumnIcon("planned", false, undefined, "backlog")
            : getColumnIcon(
                row.status,
                statusColumn?.isFinal,
                statusColumn?.icon ?? undefined,
                statusColumn?.group,
              )}
          <span className="truncate">
            {row.status === "planned"
              ? t("tasks:groups.planned")
              : (statusColumn?.name ?? row.status)}
          </span>
        </>
      );
      return (
        <LazyEditor
          display={display}
          editable={canEdit}
          renderEditor={(trigger) => (
            <TaskStatusPopover task={task()}>{trigger}</TaskStatusPopover>
          )}
        />
      );
    }
    case "priority":
      return (
        <LazyEditor
          display={
            <>
              {getPriorityIcon(row.priority)}
              <span className="truncate">{getPriorityLabel(row.priority)}</span>
            </>
          }
          editable={canEdit}
          renderEditor={(trigger) => (
            <TaskPriorityPopover task={task()}>{trigger}</TaskPriorityPopover>
          )}
        />
      );
    case "assignee": {
      const assignees = (row.assigneeIds ?? []).flatMap((id) => {
        const user = meta.users.find((candidate) => candidate.id === id);
        return user
          ? [{ id: user.id, name: user.name, image: user.image }]
          : [];
      });
      return (
        <LazyEditor
          display={
            <AssigneeAvatarStack
              assignees={assignees}
              max={3}
              size="xs"
              ring="background"
              showEmpty
            />
          }
          editable={canAssign}
          renderEditor={(trigger) => (
            <TaskAssigneePopover task={task()} workspaceId={workspaceId}>
              {trigger}
            </TaskAssigneePopover>
          )}
        />
      );
    }
    case "labels": {
      const labels = row.labels ?? [];
      const display =
        labels.length === 0 ? (
          <Muted>{t("tasks:filters.values.noLabel")}</Muted>
        ) : (
          <LabelChips
            labels={labels.map((label) => ({ ...label, id: label.name }))}
            max={2}
            className="flex-nowrap items-center"
          />
        );
      return (
        <LazyEditor
          display={display}
          editable={canEdit}
          renderEditor={(trigger) => (
            <TaskLabelsPopover task={task()} workspaceId={workspaceId}>
              {trigger}
            </TaskLabelsPopover>
          )}
        />
      );
    }
    case "modules":
      if (!project?.modulesEnabled) return <Plain>{null}</Plain>;
      return (
        <SpreadsheetModulesEditor row={row} meta={meta} canEdit={canEdit} />
      );
    case "cycle":
      if (!project?.cyclesEnabled) return <Plain>{null}</Plain>;
      return <SpreadsheetCycleEditor row={row} meta={meta} canEdit={canEdit} />;
    case "estimate":
      if (!project?.estimatesEnabled) return <Plain>{null}</Plain>;
      return (
        <SpreadsheetEstimateEditor
          row={row}
          meta={meta}
          workspaceId={workspaceId}
          canEdit={canEdit}
          format={formatEstimateValue}
        />
      );
    case "startDate":
      return (
        <LazyEditor
          display={
            row.startDate ? (
              <span>{formatDateShort(row.startDate)}</span>
            ) : (
              <Muted>{t("tasks:properties.noDate")}</Muted>
            )
          }
          editable={canEdit}
          renderEditor={(trigger) => (
            <TaskStartDatePopover task={task()}>{trigger}</TaskStartDatePopover>
          )}
        />
      );
    case "dueDate":
      return (
        <LazyEditor
          display={
            row.dueDate ? (
              <DueDateChip row={row} />
            ) : (
              <Muted>{t("tasks:properties.noDate")}</Muted>
            )
          }
          editable={canEdit}
          renderEditor={(trigger) => (
            <TaskDueDatePopover task={task()}>{trigger}</TaskDueDatePopover>
          )}
        />
      );
    case "subTaskCount":
      return (
        <Plain>
          <span className={cn(!row.subTaskCount && "text-muted-foreground")}>
            {row.subTaskCount ?? 0}
          </span>
        </Plain>
      );
    case "createdAt":
      return <Plain>{formatDateShort(row.createdAt)}</Plain>;
    case "updatedAt":
      return (
        <Plain>
          <span title={row.updatedAt}>{formatRelativeTime(row.updatedAt)}</span>
        </Plain>
      );
    default:
      return <Plain>{null}</Plain>;
  }
}

/** A custom field value, read-only in the spreadsheet (B4 §10). */
export function CustomFieldCell({
  row,
  fieldId,
}: {
  row: TaskQueryRow;
  fieldId: string;
}) {
  const value = row.customFieldValues?.find(
    (entry) => entry.fieldId === fieldId,
  )?.value;
  return (
    <Plain>
      <span className="truncate">{value ?? ""}</span>
    </Plain>
  );
}

export { cellButtonClass };
