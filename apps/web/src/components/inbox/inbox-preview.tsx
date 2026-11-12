import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronRight,
  Maximize2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AgentReplyCard,
  agentReplyOf,
} from "@/components/ai/agents/agent-reply-card";
import { ApprovalCard } from "@/components/ai/agents/approval-card";
import { AgentItemShownAbove } from "@/components/ai/agents/task-agent-waiting";
import AiMarkdown from "@/components/ai/ai-markdown";
import TaskDetailsContent from "@/components/task/task-details-content";
import { TaskDetailsSkeleton } from "@/components/task/task-page-skeleton";
import TaskPropertiesSidebar from "@/components/task/task-properties-sidebar";
import TaskSubscribeButton from "@/components/task/task-subscribe-button";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { ProjectScope } from "@/hooks/use-project-scope";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { formatDateTime } from "@/lib/format";
import {
  getNotificationCommentId,
  getNotificationContent,
  getNotificationMarkdown,
  getNotificationTitle,
  getPageNotificationTarget,
  getProjectUpdateTarget,
  pageNotificationSearch,
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
  title,
  onAction,
  onClose,
  onOpenFullPage,
  snoozeSignal,
  children,
}: {
  notification: InboxNotification;
  /** The task's current title; the notification's copy until it loads. */
  title?: string;
  onAction: InboxActionHandler;
  onClose: () => void;
  onOpenFullPage?: () => void;
  snoozeSignal?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const taskTitle = title ?? notification.task?.title;
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
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {notification.task && (
          <>
            {/* The body repeats the key, so a phone keeps the room for the title. */}
            <span className="hidden shrink-0 font-mono text-muted-foreground text-xs sm:inline">
              {notification.task.key}
            </span>
            <span
              className="truncate font-medium text-foreground text-sm"
              title={taskTitle}
            >
              {taskTitle}
            </span>
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

function agentApprovalOf(
  notification: InboxNotification,
): { approvalId: string; runId: string } | null {
  if (notification.type !== "ai_approval_requested") return null;
  const data = notification.eventData as Record<string, unknown> | null;
  return typeof data?.approvalId === "string" && typeof data.runId === "string"
    ? { approvalId: data.approvalId, runId: data.runId }
    : null;
}

/**
 * The selected notification's task with the conversation first: properties
 * stay behind a toggle, and load only once someone opens them.
 */
function TaskPreview({
  notification,
  task,
  workspaceId,
  onAction,
  onClose,
  snoozeSignal,
  propertiesOpen,
  onPropertiesOpenChange,
}: {
  notification: InboxNotification;
  task: NonNullable<InboxNotification["task"]>;
  workspaceId: string;
  onAction: InboxActionHandler;
  onClose: () => void;
  snoozeSignal?: number;
  propertiesOpen: boolean;
  onPropertiesOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
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
  // An agent's proposed change waits for this person: review it here.
  const approval = agentApprovalOf(notification);
  // An agent's answer that isn't on the task.
  const reply = agentReplyOf(notification);

  const header = (
    <PreviewHeader
      notification={notification}
      title={data?.title}
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
    // Everything here acts in the task's project.
    <ProjectScope projectId={task.projectId}>
      {header}
      {/* One scroll for both, so open properties can't squeeze out the task. */}
      <div className="min-h-0 flex-1 overflow-y-auto" key={task.id}>
        <Collapsible
          open={propertiesOpen}
          onOpenChange={onPropertiesOpenChange}
          className="border-border border-b bg-sidebar"
        >
          <CollapsibleTrigger className="flex min-h-9 w-full items-center gap-1.5 px-3 text-left text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset pointer-coarse:min-h-11">
            {propertiesOpen ? (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="shrink-0">
              {propertiesOpen
                ? t("notifications:inbox.preview.hideProperties")
                : t("notifications:inbox.preview.showProperties")}
            </span>
            <span className="ms-auto min-w-0 truncate ps-2">
              {task.projectName}
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <TaskPropertiesSidebar
              taskId={task.id}
              projectId={task.projectId}
              workspaceId={workspaceId}
              className="flex w-full flex-col gap-0"
              compact
            />
          </CollapsiblePanel>
        </Collapsible>
        <div className="px-4 py-4">
          {approval && (
            <div className="mb-4">
              <ApprovalCard
                workspaceId={workspaceId}
                runId={approval.runId}
                approvalId={approval.approvalId}
              />
            </div>
          )}
          {reply && (
            <div className="mb-4">
              <AgentReplyCard
                workspaceId={workspaceId}
                runId={reply.runId}
                agentName={reply.agentName}
                text={reply.text}
                needsInput={reply.needsInput}
              />
            </div>
          )}
          {/* The card above already shows this question or change. */}
          <AgentItemShownAbove.Provider
            value={{
              runId: reply?.needsInput ? reply.runId : undefined,
              approvalId: approval?.approvalId,
            }}
          >
            <TaskDetailsContent
              taskId={task.id}
              projectId={task.projectId}
              workspaceId={workspaceId}
              className="flex flex-col gap-3"
            />
          </AgentItemShownAbove.Provider>
        </div>
      </div>
    </ProjectScope>
  );
}

// Long words and links wrap, so this pane never scrolls sideways.
const NOTICE_PANE =
  "flex min-w-0 flex-1 items-start justify-center overflow-y-auto overflow-x-hidden p-4 sm:p-6";

/** A notification without a task: workspace news, integration messages. */
function NoticePreview({
  notification,
  workspaceId,
}: {
  notification: InboxNotification;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const content = getNotificationContent(notification, t);
  const markdown = getNotificationMarkdown(notification, t);
  const page = getPageNotificationTarget(notification);
  const updates = getProjectUpdateTarget(notification);
  // An agent's question from a run without a task (a schedule, the Agent
  // Desk): answered right here, as on a task.
  const reply = agentReplyOf(notification);
  if (reply?.needsInput) {
    return (
      <div className={NOTICE_PANE}>
        <div className="w-full min-w-0 max-w-lg">
          <AgentReplyCard
            workspaceId={workspaceId}
            runId={reply.runId}
            agentName={reply.agentName}
            text={reply.text}
            needsInput
          />
        </div>
      </div>
    );
  }
  return (
    <div className={NOTICE_PANE}>
      <div className="flex w-full min-w-0 max-w-lg gap-3 rounded-xl border border-border/80 bg-card/60 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bell className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium text-sm wrap-anywhere">
            {getNotificationTitle(notification, t)}
          </p>
          {markdown ? (
            <AiMarkdown
              text={markdown}
              safeLinks
              className="text-muted-foreground wrap-anywhere [&_a]:text-foreground"
            />
          ) : (
            content && (
              <p className="text-muted-foreground text-sm wrap-anywhere">
                {content}
              </p>
            )
          )}
          <p className="text-muted-foreground text-xs">
            {formatDateTime(notification.createdAt)}
          </p>
          {page && (
            <Button
              variant="outline"
              size="xs"
              className="mt-1 w-fit"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, ...page },
                  search: pageNotificationSearch(notification),
                })
              }
            >
              {t("pages:notification.openPage")}
            </Button>
          )}
          {updates && (
            <Button
              variant="outline"
              size="xs"
              className="mt-1 w-fit"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/updates",
                  params: { workspaceId, projectId: updates.projectId },
                })
              }
            >
              {t("projectUpdates:notifications.open")}
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
  // Kept here so the choice holds while moving between notifications.
  const [propertiesOpen, setPropertiesOpen] = useState(false);

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
        propertiesOpen={propertiesOpen}
        onPropertiesOpenChange={setPropertiesOpen}
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
        <NoticePreview notification={notification} workspaceId={workspaceId} />
      )}
    </>
  );
}
