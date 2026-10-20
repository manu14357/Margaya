import {
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Copy,
  GitBranch,
  Plus,
  Repeat,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcuts } from "@/constants/shortcuts";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetGiteaIntegration from "@/hooks/queries/gitea-integration/use-get-gitea-integration";
import useGetGithubIntegration from "@/hooks/queries/github-integration/use-get-github-integration";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useTaskRecurrence from "@/hooks/queries/task-recurrence/use-task-recurrence";
import { useTaskAssignees } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { copyTaskLink } from "@/lib/copy-task-reference";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { formatDateShort } from "@/lib/format";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { formatCalendarDate, recurrenceSummary } from "@/lib/recurrence";
import { formatAssigneeSummary } from "@/lib/task-assignees";
import {
  copyTaskBranch,
  DEFAULT_BRANCH_PATTERN,
  taskBranchName,
} from "@/lib/task-branch";
import { shareableTaskUrl } from "@/lib/task-key";
import { TaskPropertySlotOutlet } from "@/lib/task-property-slots";
import AssigneeAvatarStack from "./assignee-avatar-stack";
import AssigneeProfileHoverCard from "./assignee-profile-hover-card";
import TaskAssigneePopover from "./task-assignee-popover";
import TaskDueDatePopover from "./task-due-date-popover";
import TaskLabelsPopover from "./task-labels-popover";
import TaskMovePopover from "./task-move-popover";
import TaskPriorityPopover from "./task-priority-popover";
import TaskRecurrencePopover from "./task-recurrence-popover";
import TaskStartDatePopover from "./task-start-date-popover";
import TaskStatusPopover from "./task-status-popover";

const NO_TASK = { userId: null } as const;

// Ghost value triggers line their text up with the label column.
const VALUE_BUTTON =
  "h-7 max-w-full justify-start gap-1.5 px-1.5 font-medium text-xs";

type PropertyRowProps = {
  /** Stable hook for tests and styling: `data-property`. */
  property: string;
  label?: ReactNode;
  children: ReactNode;
};

/**
 * One label/value pair of the property grid. A row whose value renders
 * nothing (a slot with nothing to show) hides itself.
 */
function PropertyRow({ property, label, children }: PropertyRowProps) {
  return (
    <div
      data-property={property}
      className="col-span-2 grid min-h-8 grid-cols-subgrid items-center [&:not(:has(>dd>*))]:hidden"
    >
      {label ? (
        <dt className="truncate text-muted-foreground text-xs">{label}</dt>
      ) : null}
      <dd
        className={cn(
          "-ml-1.5 flex min-w-0 flex-wrap items-center gap-1",
          !label && "col-span-2",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

type TaskPropertiesSidebarProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  className?: string;
  /** Tighter label column for the sheet and the inbox preview. */
  compact?: boolean;
};

/**
 * The task's properties as a two-column grid (label, value): the built-in
 * fields, then every registered "sidebar" slot (parent, cycle, modules,
 * estimate, time spent). Used by the task page's side panel, the sheet and
 * the inbox preview.
 */
export default function TaskPropertiesSidebar({
  taskId,
  projectId,
  workspaceId,
  className,
  compact = false,
}: TaskPropertiesSidebarProps) {
  const { t, i18n } = useTranslation();
  const { data: task } = useGetTask(taskId ?? "");
  const { data: recurrence } = useTaskRecurrence(taskId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: columns = [] } = useGetColumns(projectId);
  const taskIsCompleted = isTaskCompleted(task?.status ?? "", columns);
  const assignees = useTaskAssignees(task ?? NO_TASK, workspaceId);
  const { data: taskLabels = [] } = useGetLabelsByTask(taskId ?? "");
  const { data: githubIntegration } = useGetGithubIntegration(projectId);
  const { data: giteaIntegration } = useGetGiteaIntegration(projectId);
  const { data: workspaceProjects = [] } = useGetProjects({ workspaceId });
  const canMoveTask =
    Boolean(task) && workspaceProjects.some((p) => p.id !== task?.projectId);
  const statusColumn = columns.find(
    (column) => column.slug === task?.status || column.id === task?.status,
  );
  const statusLabel = getStatusDisplayLabel(
    task?.status ?? "",
    statusColumn?.name,
  );

  const branchPattern =
    githubIntegration?.branchPattern ||
    giteaIntegration?.branchPattern ||
    DEFAULT_BRANCH_PATTERN;

  const handleCopyTaskLink = () => {
    if (!taskId) return;
    const ownProjectId = task?.projectId ?? projectId;
    void copyTaskLink(
      shareableTaskUrl({
        workspaceId,
        projectId: ownProjectId,
        taskId,
        slug: project?.id === ownProjectId ? project.slug : undefined,
        number: task?.number,
      }),
      t,
    );
  };

  const handleCopyTaskBranch = () => {
    const branchName = taskBranchName(
      branchPattern,
      project?.slug,
      task?.number,
      task?.title,
    );
    if (branchName) void copyTaskBranch(branchName, t);
  };

  // Row labels for the slots registered on the "sidebar" location, by slot
  // id. A slot without one spans the whole row instead.
  const slotLabels: Record<string, string> = {
    parent: t("tasks:parent.label"),
    cycle: t("cycles:picker.label"),
    module: t("modules:picker.label"),
    estimate: t("tasks:estimate.label"),
    timeTracking: t("tasks:timeTracking.label"),
  };

  const dueStatus = task?.dueDate
    ? getDueDateStatus(task.dueDate, taskIsCompleted)
    : null;
  const DueIcon =
    dueStatus === "overdue"
      ? CalendarX
      : dueStatus === "due-soon"
        ? CalendarClock
        : Calendar;

  return (
    <section
      aria-label={t("tasks:properties.title")}
      className={cn("flex min-w-0 flex-col gap-2 p-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("tasks:properties.title")}
        </h2>
        <div className="flex">
          {task && canMoveTask && (
            <TaskMovePopover
              task={task}
              workspaceId={workspaceId}
              triggerClassName="rounded-l-md rounded-r-none border-r-0"
            />
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "border-r-0 text-foreground",
                    canMoveTask ? "rounded-none" : "rounded-r-none",
                  )}
                  onClick={handleCopyTaskLink}
                  aria-label={t("tasks:properties.copyTaskLink")}
                >
                  <Copy className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <KbdSequence
                  keys={[
                    shortcuts.taskDetails.modifier,
                    "Shift",
                    shortcuts.taskDetails.copyLink,
                  ]}
                  description={t("tasks:properties.copyTaskLink")}
                  separator=""
                />
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-l-none text-foreground"
                  onClick={handleCopyTaskBranch}
                  aria-label={t("tasks:properties.copyTaskBranch")}
                >
                  <GitBranch className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <KbdSequence
                  keys={[
                    shortcuts.taskDetails.modifier,
                    "Shift",
                    shortcuts.taskDetails.copyBranch,
                  ]}
                  description={t("tasks:properties.copyTaskBranch")}
                  separator=""
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {task && (
        <dl
          className={cn(
            "grid gap-x-3",
            compact
              ? "grid-cols-[6rem_minmax(0,1fr)]"
              : "grid-cols-[6.5rem_minmax(0,1fr)]",
          )}
        >
          <PropertyRow property="status" label={t("tasks:status.label")}>
            <TaskStatusPopover task={task}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                {getColumnIcon(
                  task.status ?? "",
                  statusColumn?.isFinal ?? false,
                  statusColumn?.icon,
                  statusColumn?.group,
                )}
                <span className="truncate">{statusLabel}</span>
              </Button>
            </TaskStatusPopover>
          </PropertyRow>

          <PropertyRow property="priority" label={t("tasks:priority.label")}>
            <TaskPriorityPopover task={task}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                {getPriorityIcon(task.priority ?? "")}
                <span className="truncate">
                  {getPriorityLabel(task.priority ?? "")}
                </span>
              </Button>
            </TaskPriorityPopover>
          </PropertyRow>

          <PropertyRow property="assignees" label={t("tasks:assignees.label")}>
            {/* The faces (tooltip lists every name) and "Unassigned", the
                one name, or "{first name} +{others}". */}
            <TaskAssigneePopover task={task} workspaceId={workspaceId}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                <AssigneeProfileHoverCard
                  workspaceId={workspaceId}
                  assignees={assignees}
                >
                  <AssigneeAvatarStack
                    assignees={assignees}
                    max={3}
                    size="xs"
                    ring="background"
                    showEmpty
                  />
                </AssigneeProfileHoverCard>
                <span className="truncate">
                  {formatAssigneeSummary(assignees, t)}
                </span>
              </Button>
            </TaskAssigneePopover>
          </PropertyRow>

          <PropertyRow
            property="startDate"
            label={t("tasks:properties.startDate")}
          >
            <TaskStartDatePopover task={task}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                <CalendarDays className="size-3.5 text-muted-foreground" />
                <span
                  className={cn(!task.startDate && "text-muted-foreground")}
                >
                  {task.startDate
                    ? formatDateShort(task.startDate)
                    : t("tasks:properties.noDate")}
                </span>
              </Button>
            </TaskStartDatePopover>
          </PropertyRow>

          <PropertyRow property="dueDate" label={t("tasks:dueDate.label")}>
            <TaskDueDatePopover task={task}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                <DueIcon
                  className={cn(
                    "size-3.5",
                    dueStatus
                      ? dueDateStatusColors[dueStatus]
                      : "text-muted-foreground",
                  )}
                />
                <span className={cn(!task.dueDate && "text-muted-foreground")}>
                  {task.dueDate
                    ? formatDateShort(task.dueDate)
                    : t("tasks:properties.noDate")}
                </span>
              </Button>
            </TaskDueDatePopover>
          </PropertyRow>

          <PropertyRow property="repeat" label={t("tasks:recurrence.label")}>
            <TaskRecurrencePopover task={task} rule={recurrence}>
              <Button variant="ghost" size="sm" className={VALUE_BUTTON}>
                <Repeat className="size-3.5 text-muted-foreground" />
                <span
                  className={cn(
                    "truncate",
                    !recurrence && "text-muted-foreground",
                  )}
                >
                  {recurrence
                    ? recurrenceSummary(recurrence, t, i18n.language)
                    : t("tasks:recurrence.none")}
                </span>
              </Button>
            </TaskRecurrencePopover>
            {recurrence && (
              <span className="w-full pl-1.5 text-[11px] text-muted-foreground">
                {recurrence.nextDate
                  ? t("tasks:recurrence.next", {
                      date: formatCalendarDate(
                        recurrence.nextDate,
                        i18n.language,
                      ),
                    })
                  : t("tasks:recurrence.ended")}
              </span>
            )}
          </PropertyRow>

          <PropertyRow property="labels" label={t("tasks:properties.labels")}>
            <div className="flex min-h-7 flex-wrap items-center gap-1 pl-1.5">
              {taskLabels.map(
                (label: { id: string; name: string; color: string }) => (
                  <TaskLabelsPopover
                    key={`edit-${label.id}`}
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
                        style={{
                          backgroundColor: resolveLabelColor(label.color),
                        }}
                      />
                      <span className="max-w-24 truncate">{label.name}</span>
                    </Badge>
                  </TaskLabelsPopover>
                ),
              )}
              <TaskLabelsPopover task={task} workspaceId={workspaceId}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full text-muted-foreground"
                  aria-label={t("tasks:properties.addLabel")}
                >
                  <Plus className="size-3.5" />
                </Button>
              </TaskLabelsPopover>
            </div>
          </PropertyRow>

          <TaskPropertySlotOutlet
            location="sidebar"
            projectId={projectId}
            workspaceId={workspaceId}
            props={{ task, layout: "stack" }}
            renderSlot={(node, slot) => (
              <PropertyRow property={slot.id} label={slotLabels[slot.id]}>
                {node}
              </PropertyRow>
            )}
          />
        </dl>
      )}
    </section>
  );
}
