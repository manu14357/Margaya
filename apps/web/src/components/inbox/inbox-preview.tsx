import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bell, Maximize2, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import TaskDetailsContent from "@/components/task/task-details-content";
import { TaskDetailsSkeleton } from "@/components/task/task-page-skeleton";
import TaskPropertiesSidebar from "@/components/task/task-properties-sidebar";
import TaskSubscribeButton from "@/components/task/task-subscribe-button";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { formatDateTime } from "@/lib/format";
import {
  getNotificationCommentId,
  getNotificationContent,
  getNotificationTitle,
  getPageNotificationTarget,
} from "@/lib/notification-text";
import type { InboxNotification } from "@/types/notification";
import { InboxPreviewEmpty, InboxPreviewUnavailable } from "./inbox-empty";
import InboxRowActions, { type InboxActionHandler } from "./inbox-row-actions";

const FLASH_CLASSES = ["ring-2", "ring-primary/40"];

/**
 * Scrolls a comment notification's comment into view and flashes it, once
 * the task's activity has rendered it.
 */
function useScrollToComment(commentId: string | null, ready: boolean) {
  useEffect(() => {
    if (!commentId || !ready) return;
    let attempts = 0;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      attempts += 1;
      const node = document.getElementById(`comment-${commentId}`);
      if (!node && attempts < 20) return;
      clearInterval(interval);
      if (!node) return;
      node.scrollIntoView?.({ block: "center", behavior: "smooth" });
      node.classList.add(...FLASH_CLASSES);
      flashTimer = setTimeout(
        () => node.classList.remove(...FLASH_CLASSES),
        1500,
      );
    }, 100);
    return () => {
      clearInterval(interval);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, [commentId, ready]);
}

type InboxPreviewProps = {
  notification: InboxNotification | null;
  workspaceId: string;
  onAction: InboxActionHandler;
  onClose: () => void;
  /** Bumped by the page's S key: opens the header's snooze menu. */
  snoozeSignal?: number;
};

function PreviewHeader({
  notification,
  onAction,
  onClose,
  onOpenFullPage,
  snoozeSignal,
  children,
}: {
  notification: InboxNotification;
  onAction: InboxActionHandler;
  onClose: () => void;
  onOpenFullPage?: () => void;
  snoozeSignal?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2 lg:px-3">
      {/* One pane at a time below lg: the way back to the list. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("notifications:inbox.actions.backToList")}
        onClick={onClose}
        className="shrink-0 text-foreground lg:hidden"
      >
        <ArrowLeft className="size-4" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground text-xs">
        {notification.task && (
          <>
            <span className="shrink-0 font-mono">{notification.task.key}</span>
            <span className="truncate">{notification.task.projectName}</span>
          </>
        )}
      </div>
      <TooltipProvider>
        <div className="flex shrink-0 items-center gap-1">
          {children}
          {onOpenFullPage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("notifications:inbox.actions.openFullPage")}
                  onClick={onOpenFullPage}
                  className="text-foreground"
                >
                  <Maximize2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {t("notifications:inbox.actions.openFullPage")}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          <InboxRowActions
            notification={notification}
            onAction={onAction}
            showReadToggle={false}
            showShortcuts
            snoozeSignal={snoozeSignal}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("notifications:inbox.actions.closePreview")}
                onClick={onClose}
                className="hidden text-foreground lg:inline-flex"
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {t("notifications:inbox.actions.closePreview")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}

/** The selected notification's task, composed as in the task sheet. */
function TaskPreview({
  notification,
  task,
  workspaceId,
  onAction,
  onClose,
  snoozeSignal,
}: {
  notification: InboxNotification;
  task: NonNullable<InboxNotification["task"]>;
  workspaceId: string;
  onAction: InboxActionHandler;
  onClose: () => void;
  snoozeSignal?: number;
}) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGetTask(task.id);
  useProjectWebSocket(task.projectId);
  useRecordVisit({
    workspaceId,
    entityType: "task",
    entityId: task.id,
    archived: visitArchiveState(data),
  });
  useScrollToComment(
    getNotificationCommentId(notification),
    Boolean(data) && !isLoading,
  );

  const header = (
    <PreviewHeader
      notification={notification}
      onAction={onAction}
      onClose={onClose}
      snoozeSignal={snoozeSignal}
      onOpenFullPage={() =>
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
          params: { workspaceId, projectId: task.projectId, taskId: task.id },
        })
      }
    >
      <TaskSubscribeButton taskId={task.id} />
    </PreviewHeader>
  );

  if (isLoading) {
    return (
      <>
        {header}
        <TaskDetailsSkeleton className="p-4" />
      </>
    );
  }
  if (isError || !data) {
    return (
      <>
        {header}
        <InboxPreviewUnavailable />
      </>
    );
  }

  return (
    <>
      {header}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        key={task.id}
      >
        <TaskPropertiesSidebar
          taskId={task.id}
          projectId={task.projectId}
          workspaceId={workspaceId}
          className="flex w-full shrink-0 flex-col gap-0 overflow-y-auto border-border border-b bg-sidebar"
          compact
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-4">
            <TaskDetailsContent
              taskId={task.id}
              projectId={task.projectId}
              workspaceId={workspaceId}
              className="flex flex-col gap-3"
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** A notification without a task: workspace news, integration messages. */
function NoticePreview({ notification }: { notification: InboxNotification }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const content = getNotificationContent(notification, t);
  const page = getPageNotificationTarget(notification);
  const workspaceId = notification.workspaceId;
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-lg gap-3 rounded-xl border border-border/80 bg-card/60 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bell className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-sm">
            {getNotificationTitle(notification, t)}
          </p>
          {content && (
            <p className="text-muted-foreground text-sm">{content}</p>
          )}
          <p className="text-muted-foreground/70 text-xs">
            {formatDateTime(notification.createdAt)}
          </p>
          {page && workspaceId && (
            <Button
              variant="outline"
              size="xs"
              className="mt-1 w-fit"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, ...page },
                })
              }
            >
              {t("pages:notification.openPage")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The inbox's reading pane. */
export default function InboxPreview({
  notification,
  workspaceId,
  onAction,
  onClose,
  snoozeSignal,
}: InboxPreviewProps) {
  if (!notification) return <InboxPreviewEmpty />;

  if (notification.task) {
    return (
      <TaskPreview
        key={notification.id}
        notification={notification}
        task={notification.task}
        workspaceId={workspaceId}
        onAction={onAction}
        onClose={onClose}
        snoozeSignal={snoozeSignal}
      />
    );
  }

  return (
    <>
      <PreviewHeader
        notification={notification}
        onAction={onAction}
        onClose={onClose}
        snoozeSignal={snoozeSignal}
      />
      {notification.resourceType === "task" ? (
        <InboxPreviewUnavailable />
      ) : (
        <NoticePreview notification={notification} />
      )}
    </>
  );
}
