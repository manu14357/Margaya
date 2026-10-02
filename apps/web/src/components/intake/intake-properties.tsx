import { Calendar, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import TaskDueDatePopover from "@/components/task/task-due-date-popover";
import TaskLabelsPopover from "@/components/task/task-labels-popover";
import TaskPriorityPopover from "@/components/task/task-priority-popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { formatDateShort } from "@/lib/format";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { formatAssigneeSummary } from "@/lib/task-assignees";
import type Task from "@/types/task";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1.5 font-medium text-foreground/70 text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

const triggerClassName = "h-7 w-full justify-start gap-1.5 px-1.5";

type IntakePropertiesProps = {
  task: Task;
  workspaceId: string;
};

/**
 * Priority, assignee, labels and due date of the request's task, through
 * the task sidebar's own popovers (each read-only without its permission).
 * There is no status row: accepting is the only way out of triage.
 */
export default function IntakeProperties({
  task,
  workspaceId,
}: IntakePropertiesProps) {
  const { t } = useTranslation();
  const assignees = useTaskAssignees(task, workspaceId);
  const { data: labels = [] } = useGetLabelsByTask(task.id);

  return (
    <div className="flex flex-col gap-3">
      <span className="px-1.5 font-semibold text-sm">
        {t("intake:detail.properties")}
      </span>
      <Row label={t("intake:detail.priority")}>
        <TaskPriorityPopover task={task}>
          <Button variant="ghost" size="sm" className={triggerClassName}>
            {getPriorityIcon(task.priority ?? "")}
            <span className="truncate font-semibold text-xs">
              {getPriorityLabel(task.priority ?? "no-priority")}
            </span>
          </Button>
        </TaskPriorityPopover>
      </Row>
      <Row label={t("intake:detail.assignee")}>
        <TaskAssigneePopover task={task} workspaceId={workspaceId}>
          <Button variant="ghost" size="sm" className={triggerClassName}>
            <AssigneeAvatarStack
              assignees={assignees}
              max={3}
              size="xs"
              ring="background"
              showEmpty
            />
            <span className="truncate font-semibold text-xs">
              {formatAssigneeSummary(assignees, t)}
            </span>
          </Button>
        </TaskAssigneePopover>
      </Row>
      <Row label={t("intake:detail.labels")}>
        <div className="flex flex-wrap items-center gap-1.5 px-1.5">
          {labels.map((label: { id: string; name: string; color: string }) => (
            <TaskLabelsPopover
              key={label.id}
              task={task}
              workspaceId={workspaceId}
              triggerNativeButton={false}
            >
              <Badge
                variant="outline"
                className="flex cursor-pointer items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent/50"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: resolveLabelColor(label.color) }}
                />
                <span className="max-w-[80px] truncate">{label.name}</span>
              </Badge>
            </TaskLabelsPopover>
          ))}
          <TaskLabelsPopover task={task} workspaceId={workspaceId}>
            <Button
              variant="ghost"
              size="sm"
              className="size-5 rounded-full p-0"
              aria-label={t("intake:detail.labels")}
            >
              <Plus className="size-3" />
            </Button>
          </TaskLabelsPopover>
        </div>
      </Row>
      <Row label={t("intake:detail.dueDate")}>
        <TaskDueDatePopover task={task}>
          <Button variant="ghost" size="sm" className={triggerClassName}>
            <Calendar className="size-3.5 text-muted-foreground" />
            <span
              className={`font-semibold text-xs ${task.dueDate ? "" : "text-muted-foreground"}`}
            >
              {task.dueDate
                ? formatDateShort(task.dueDate)
                : t("tasks:properties.noDate")}
            </span>
          </Button>
        </TaskDueDatePopover>
      </Row>
    </div>
  );
}
