import { useNavigate } from "@tanstack/react-router";
import { Check, ExternalLink, Pencil, Sparkles, X } from "lucide-react";
import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import TaskLabelsPopover from "@/components/task/task-labels-popover";
import TaskPriorityPopover from "@/components/task/task-priority-popover";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TriageSuggestions as Suggestions } from "@/fetchers/ai/triage";
import { useSuggestTriage } from "@/hooks/mutations/ai/use-ai-triage";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import useAttachLabelToTask from "@/hooks/mutations/label/use-attach-label-to-task";
import { useMoveTask } from "@/hooks/mutations/task/use-move-task";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { assigneesOfTask } from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

// Triage Copilot (B7): suggestions on demand, each with a reason, applied
// only when a person accepts it (or edits it through the usual control).
// Accept all applies labels, assignee and priority; a move or a duplicate
// is always its own decision.

type ItemKey =
  | `label:${string}`
  | "assignee"
  | "priority"
  | "project"
  | `duplicate:${string}`;

type ItemState = "applied" | "dismissed";

type TriageSuggestionsProps = {
  task: Task;
  workspaceId: string;
  /** The open intake request this task belongs to, if any. */
  intakeItemId?: string;
  /** Opens the usual duplicate flow (intake dialog or relation picker). */
  onEditDuplicate?: () => void;
  className?: string;
};

function snapshotOf(task: Task, labelNames: readonly string[]) {
  return {
    priority: task.priority ?? "no-priority",
    assignees: [...assigneesOfTask(task)].sort().join(","),
    labels: [...labelNames].sort().join(","),
    projectId: task.projectId,
  };
}

export default function TriageSuggestions({
  task,
  workspaceId,
  intakeItemId,
  onEditDuplicate,
  className,
}: TriageSuggestionsProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(task.projectId);
  const permissions = useWorkspacePermission();
  const suggest = useSuggestTriage();
  const locale = useAiLocale();
  const { data: taskLabels = [] } = useGetLabelsByTask(task.id);
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [baseline, setBaseline] = useState<ReturnType<
    typeof snapshotOf
  > | null>(null);

  const isIntake = Boolean(intakeItemId);
  const canAsk = isIntake
    ? permissions.canTriageIntake()
    : permissions.canUpdateTasks();
  if (!available || permissions.isCheckingPermissions || !canAsk) return null;

  const labelNames = (taskLabels as { name: string }[]).map((l) => l.name);
  const run = () => {
    setStates({});
    setBaseline(snapshotOf(task, labelNames));
    suggest.mutate({ taskId: task.id, ...(locale ? { locale } : {}) });
  };

  if (suggest.isIdle) {
    return (
      <div className={cn("flex", className)}>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="gap-1"
          onClick={run}
        >
          <Sparkles aria-hidden className="size-3 text-muted-foreground" />
          {t("ai:triage.button")}
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-label={t("ai:triage.title")}
      className={cn(
        "rounded-lg border border-border bg-muted/30 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <h3 className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("ai:triage.title")}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("ai:triage.close")}
          title={t("ai:triage.close")}
          onClick={() => suggest.reset()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div aria-live="polite" className="mt-2">
        {suggest.isPending && (
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <Spinner className="size-3.5" />
            {t("ai:triage.loading")}
          </p>
        )}
        {suggest.isError && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-destructive-foreground">
              {t(aiErrorKey(suggest.error))}
            </span>
            <Button type="button" variant="outline" size="xs" onClick={run}>
              {t("ai:triage.retry")}
            </Button>
          </div>
        )}
        {suggest.data && baseline && (
          <SuggestionList
            data={suggest.data}
            task={task}
            workspaceId={workspaceId}
            intakeItemId={intakeItemId}
            labelNames={labelNames}
            baseline={baseline}
            states={states}
            setState={(key, state) =>
              setStates((current) => ({ ...current, [key]: state }))
            }
            onEditDuplicate={onEditDuplicate}
          />
        )}
      </div>
    </section>
  );
}

function SuggestionList({
  data,
  task,
  workspaceId,
  intakeItemId,
  labelNames,
  baseline,
  states,
  setState,
  onEditDuplicate,
}: {
  data: Suggestions;
  task: Task;
  workspaceId: string;
  intakeItemId?: string;
  labelNames: readonly string[];
  baseline: ReturnType<typeof snapshotOf>;
  states: Record<string, ItemState>;
  setState: (key: ItemKey, state: ItemState) => void;
  onEditDuplicate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permissions = useWorkspacePermission();
  const attachLabel = useAttachLabelToTask();
  const updateAssignees = useUpdateTaskAssignees();
  const updatePriority = useUpdateTaskPriority();
  const moveTask = useMoveTask();
  const createRelation = useCreateTaskRelation();
  const triageIntake = useTriageIntakeItem();
  const [busy, setBusy] = useState<string | null>(null);

  const current = snapshotOf(task, labelNames);
  const isIntake = Boolean(intakeItemId);
  const canEditTask = permissions.canUpdateTasks();
  const canLabel = permissions.canUpdateLabels();

  // A field someone changed by hand since the suggestion is settled.
  const settled = useMemo(
    () => ({
      priority: current.priority !== baseline.priority,
      assignee: current.assignees !== baseline.assignees,
      project: current.projectId !== baseline.projectId,
    }),
    [current.priority, current.assignees, current.projectId, baseline],
  );

  const accept = async (key: ItemKey, apply: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await apply();
      setState(key, "applied");
    } catch {
      toast.error(t("ai:triage.acceptError"));
    } finally {
      setBusy(null);
    }
  };

  type Row = {
    key: ItemKey;
    field: string;
    value: ReactNode;
    reason: string | null;
    onAccept?: () => Promise<unknown>;
    edit?: ReactNode;
    note?: string;
    /** Part of "Accept all". */
    bulk: boolean;
  };
  const rows: Row[] = [];

  for (const label of data.labels) {
    const key: ItemKey = `label:${label.labelId}`;
    const has = labelNames.includes(label.name);
    rows.push({
      key,
      field: t("ai:triage.fields.label"),
      value: (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: resolveLabelColor(label.color) }}
          />
          <span className="truncate">{label.name}</span>
        </span>
      ),
      reason: label.reason,
      onAccept:
        canLabel && !label.applied && !has
          ? () =>
              attachLabel.mutateAsync({
                labelId: label.labelId,
                taskId: task.id,
              })
          : undefined,
      edit: canLabel ? (
        <TaskLabelsPopover task={task} workspaceId={workspaceId}>
          <EditButton />
        </TaskLabelsPopover>
      ) : undefined,
      note: label.applied || has ? t("ai:triage.applied") : undefined,
      bulk: !label.applied && !has,
    });
  }

  if (data.assignee && !settled.assignee) {
    const assignee = data.assignee;
    rows.push({
      key: "assignee",
      field: t("ai:triage.fields.assignee"),
      value: <span className="truncate">{assignee.name}</span>,
      reason: assignee.reason,
      onAccept: canEditTask
        ? () =>
            updateAssignees.mutateAsync({
              taskId: task.id,
              projectId: task.projectId,
              workspaceId,
              add: [assignee.userId],
            })
        : undefined,
      edit: canEditTask ? (
        <TaskAssigneePopover task={task} workspaceId={workspaceId}>
          <EditButton />
        </TaskAssigneePopover>
      ) : undefined,
      bulk: true,
    });
  }

  if (data.priority && !settled.priority) {
    const priority = data.priority.value;
    rows.push({
      key: "priority",
      field: t("ai:triage.fields.priority"),
      value: (
        <span className="inline-flex items-center gap-1.5">
          {getPriorityIcon(priority)}
          {getPriorityLabel(priority)}
        </span>
      ),
      reason: data.priority.reason,
      onAccept: canEditTask
        ? () => updatePriority.mutateAsync({ ...task, priority })
        : undefined,
      edit: canEditTask ? (
        <TaskPriorityPopover task={task}>
          <EditButton />
        </TaskPriorityPopover>
      ) : undefined,
      bulk: true,
    });
  }

  if (data.project && !settled.project) {
    const project = data.project;
    rows.push({
      key: "project",
      field: t("ai:triage.fields.project"),
      value: <span className="truncate">{project.name}</span>,
      reason: project.reason,
      // Requests can't move; the suggestion is advice there.
      onAccept:
        !isIntake && canEditTask
          ? async () => {
              await moveTask.mutateAsync({
                taskId: task.id,
                destinationProjectId: project.projectId,
              });
              void navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                params: {
                  workspaceId,
                  projectId: project.projectId,
                  taskId: task.id,
                },
              });
            }
          : undefined,
      note: isIntake ? t("ai:triage.projectAdvice") : undefined,
      bulk: false,
    });
  }

  for (const duplicate of data.duplicates) {
    const key: ItemKey = `duplicate:${duplicate.taskId}`;
    const sameProject = duplicate.projectId === task.projectId;
    const href = `/dashboard/workspace/${workspaceId}/project/${duplicate.projectId}/task/${duplicate.taskId}`;
    rows.push({
      key,
      field: t("ai:triage.fields.duplicate"),
      value: (
        <a
          href={href}
          target="_blank"
          rel="noopener"
          className="inline-flex min-w-0 items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("ai:triage.openTask", { key: duplicate.key })}
        >
          <span className="shrink-0 font-mono text-muted-foreground text-xs">
            {duplicate.key}
          </span>
          <span className="truncate">{duplicate.title}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
      ),
      reason: duplicate.reason ?? t("ai:triage.sameTitle"),
      onAccept: isIntake
        ? sameProject && intakeItemId && permissions.canTriageIntake()
          ? () =>
              triageIntake.mutateAsync({
                id: intakeItemId,
                projectId: task.projectId,
                action: "duplicate",
                duplicateOfTaskId: duplicate.taskId,
              })
          : undefined
        : canEditTask
          ? () =>
              createRelation.mutateAsync({
                sourceTaskId: task.id,
                targetTaskId: duplicate.taskId,
                relationType: "duplicate",
              })
          : undefined,
      edit: onEditDuplicate ? (
        <EditButton onClick={onEditDuplicate} />
      ) : undefined,
      note:
        isIntake && !sameProject
          ? t("ai:triage.otherProjectDuplicate")
          : undefined,
      bulk: false,
    });
  }

  const visible = rows.filter((row) => states[row.key] !== "dismissed");
  const bulk = visible.filter(
    (row) => row.bulk && row.onAccept && states[row.key] !== "applied",
  );

  return (
    <div className="flex flex-col gap-2">
      {data.autoApplied && (
        <p className="text-muted-foreground text-xs">
          {t("ai:triage.autoApplied")}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t("ai:triage.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70">
          {visible.map((row) => {
            const applied = states[row.key] === "applied";
            return (
              <li
                key={row.key}
                className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {row.field}
                    </span>
                    <span className="flex min-w-0 items-center">
                      {row.value}
                    </span>
                  </div>
                  {row.reason && (
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {row.reason}
                    </p>
                  )}
                  {row.note && !applied && (
                    <p className="mt-0.5 text-muted-foreground text-xs italic">
                      {row.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {applied ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                      <Check aria-hidden className="size-3.5" />
                      {t("ai:triage.applied")}
                    </span>
                  ) : (
                    <>
                      {row.onAccept && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="gap-1"
                          disabled={busy !== null}
                          onClick={() =>
                            row.onAccept && void accept(row.key, row.onAccept)
                          }
                        >
                          {busy === row.key ? (
                            <Spinner className="size-3" />
                          ) : (
                            <Check aria-hidden className="size-3" />
                          )}
                          {t("ai:triage.accept")}
                        </Button>
                      )}
                      {row.edit}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("ai:triage.dismiss")}
                        title={t("ai:triage.dismiss")}
                        onClick={() => setState(row.key, "dismissed")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {bulk.length > 1 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="gap-1"
            disabled={busy !== null}
            onClick={async () => {
              for (const row of bulk) {
                if (row.onAccept) await accept(row.key, row.onAccept);
              }
            }}
          >
            <Check aria-hidden className="size-3" />
            {t("ai:triage.acceptAll")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Edit": opens the usual control (popovers pass their trigger props). */
function EditButton(props: ComponentProps<typeof Button>) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="gap-1"
      {...props}
    >
      <Pencil aria-hidden className="size-3" />
      {t("ai:triage.edit")}
    </Button>
  );
}
