import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import TaskDescription from "@/components/task/task-description";
import {
  TaskDetailsSkeleton,
  TaskPropertiesSidebarSkeleton,
} from "@/components/task/task-page-skeleton";
import TaskTitle from "@/components/task/task-title";
import { invalidateIntakeQueries } from "@/hooks/mutations/intake/invalidate-intake-queries";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import { useGetIntakeItem } from "@/hooks/queries/intake/use-get-intake-item";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { effectiveIntakeStatus, intakeItemPath } from "@/lib/intake";
import {
  type IntakeDetailAction,
  intakeDetailActions,
} from "@/lib/intake-actions";
import { toast } from "@/lib/toast";
import type { IntakeItem } from "@/types/intake";
import IntakeActivityFeed from "./intake-activity-feed";
import IntakeDetailDialogs, {
  type IntakeDialog,
} from "./intake-detail-dialogs";
import IntakeDetailHeader from "./intake-detail-header";
import IntakeEmptyState from "./intake-empty-state";
import IntakeOutcomeBanner from "./intake-outcome-banner";
import IntakeProperties from "./intake-properties";
import IntakeRequestMeta from "./intake-request-meta";

/** What the triage queue's keys ask of the open request. */
export type IntakeTriageCommand =
  | "accept"
  | "decline"
  | "snooze"
  | "duplicate"
  | "open";

/** Runs a command; false when the request doesn't offer it. */
export type IntakeTriageHandler = (command: IntakeTriageCommand) => boolean;

type IntakeDetailProps = {
  itemId: string;
  workspaceId: string;
  /** A triage action changed the request (it may have left the list). */
  onChanged: (item: IntakeItem) => void;
  onDeleted: (item: IntakeItem) => void;
  /** Clears the selection (the "Back to intake" of a missing request). */
  onBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Back to the list where only one pane fits. */
  onClose?: () => void;
  /** Filled with this request's handler for the queue's keyboard. */
  commandRef?: RefObject<IntakeTriageHandler | null>;
};

/** The selected request: header actions, outcome, content and properties. */
export default function IntakeDetail({
  itemId,
  workspaceId,
  onChanged,
  onDeleted,
  onBack,
  onPrevious,
  onNext,
  onClose,
  commandRef,
}: IntakeDetailProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = useWorkspacePermission();
  const { data: item, isLoading, isError } = useGetIntakeItem(itemId);
  const { data: task, isLoading: isTaskLoading } = useGetTask(
    item?.taskId ?? "",
  );
  const triage = useTriageIntakeItem();
  const [dialog, setDialog] = useState<IntakeDialog | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Title and priority edits go through the task routes; the list rows show
  // them, so they follow once the task differs from the list's snapshot.
  const taskTitle = task?.title;
  const taskPriority = task?.priority;
  useEffect(() => {
    if (!item || taskTitle === undefined) return;
    if (taskTitle !== item.task.title || taskPriority !== item.task.priority) {
      invalidateIntakeQueries(queryClient, { projectId: item.projectId });
    }
  }, [item, taskTitle, taskPriority, queryClient]);

  // The queue's keys reach the request through this handler; it is
  // replaced on every render so it always sees the current actions.
  useEffect(() => {
    if (!commandRef) return;
    return () => {
      commandRef.current = null;
    };
  }, [commandRef]);

  if (isLoading || (item && isTaskLoading)) {
    return (
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <TaskDetailsSkeleton className="min-w-0 flex-1" />
        <TaskPropertiesSidebarSkeleton className="hidden w-72 flex-col gap-2 lg:flex" />
      </div>
    );
  }

  if (isError || !item) {
    return (
      <IntakeEmptyState variant="notFound" onBack={onBack} className="h-full" />
    );
  }

  const status = effectiveIntakeStatus(item);
  const canTriage = permissions.canTriageIntake();
  const actions = permissions.isCheckingPermissions
    ? null
    : intakeDetailActions({
        status,
        canTriage,
        canUpdateTasks: permissions.canUpdateTasks(),
        canDeleteTasks: permissions.canDeleteTasks(),
        isSubmitter: Boolean(user?.id && item.submittedBy?.id === user.id),
      });

  const openTask = (taskId: string, projectId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId, taskId },
    });

  const runSimple = (action: "unsnooze" | "reopen") =>
    triage.mutate(
      { id: item.id, projectId: item.projectId, action },
      {
        onSuccess: (changed) => {
          toast.success(
            action === "reopen"
              ? t("intake:reopen.toast")
              : t("intake:snooze.unsnoozeToast"),
          );
          onChanged(changed);
        },
        onError: (error) =>
          toast.error(
            error.message ||
              (action === "reopen"
                ? t("intake:reopen.error")
                : t("intake:snooze.error")),
          ),
      },
    );

  const handleAction = (action: IntakeDetailAction) => {
    switch (action) {
      case "unsnooze":
      case "reopen":
        return runSimple(action);
      case "copyLink":
        return void copyToClipboard(
          generateLink(
            intakeItemPath({
              workspaceId,
              projectId: item.projectId,
              itemId: item.id,
              status,
            }),
          ),
        ).then((copied) =>
          copied
            ? toast.success(t("intake:detail.linkCopied"))
            : toast.error(t("tasks:taskKey.clipboardError")),
        );
      case "openTask":
      case "openTaskPage":
        return openTask(item.taskId, item.task.projectId);
      case "snooze":
        return;
      default:
        setDialog(action);
    }
  };

  const canEditTask = permissions.canUpdateTasks();

  if (commandRef) {
    const offered = (action: IntakeDetailAction) =>
      Boolean(
        actions?.buttons.includes(action) || actions?.menu.includes(action),
      );
    commandRef.current = (command) => {
      if (command === "open") {
        if (!offered("openTaskPage") && !offered("openTask")) return false;
        openTask(item.taskId, item.task.projectId);
        return true;
      }
      if (command === "snooze") {
        if (offered("snooze")) {
          setSnoozeOpen(true);
          return true;
        }
        if (!offered("snoozeAgain")) return false;
        setDialog("snoozeAgain");
        return true;
      }
      if (!offered(command)) return false;
      setDialog(command);
      return true;
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col" key={item.id}>
      <IntakeDetailHeader
        item={item}
        actions={actions}
        onAction={handleAction}
        onSnoozed={onChanged}
        onPrevious={onPrevious}
        onNext={onNext}
        onClose={onClose}
        snoozeOpen={snoozeOpen}
        onSnoozeOpenChange={setSnoozeOpen}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <IntakeOutcomeBanner
            item={item}
            canTriage={canTriage}
            onOpenTask={() => openTask(item.taskId, item.task.projectId)}
            onOpenDuplicate={(taskId) => openTask(taskId, item.projectId)}
          />
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-3">
              <TaskTitle taskId={item.taskId} />
              <TaskDescription taskId={item.taskId} />
              <IntakeRequestMeta item={item} />
              <span className="block h-px w-full shrink-0 bg-border" />
              <IntakeActivityFeed
                taskId={item.taskId}
                canComment={!permissions.isCheckingPermissions && canEditTask}
              />
            </div>
            {task && (
              <aside className="shrink-0 border-border lg:w-72 lg:border-l lg:pl-4">
                <IntakeProperties task={task} workspaceId={workspaceId} />
              </aside>
            )}
          </div>
        </div>
      </div>
      <IntakeDetailDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        item={item}
        workspaceId={workspaceId}
        description={task?.description ?? ""}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />
    </div>
  );
}
