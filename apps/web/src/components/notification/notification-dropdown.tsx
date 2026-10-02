import { useNavigate } from "@tanstack/react-router";
import { Bell, Inbox } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcuts } from "@/constants/shortcuts";
import useClearNotifications from "@/hooks/mutations/notification/use-clear-notifications";
import useMarkAllNotificationsAsRead from "@/hooks/mutations/notification/use-mark-all-notifications-as-read";
import useUpdateNotificationState from "@/hooks/mutations/notification/use-update-notification-state";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import useInboxNotifications from "@/hooks/queries/notification/use-inbox-notifications";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { flattenInboxPages, isUnread } from "@/lib/inbox-cache";
import {
  getEventDataRecord,
  getIntakeNotificationTarget,
  getNotificationContent,
  getNotificationTitle,
  getPageNotificationTarget,
} from "@/lib/notification-text";
import type { InboxNotification } from "@/types/notification";

// The text builders moved to lib/notification-text; re-exported for older
// importers.
export { getNotificationContent, getNotificationTitle };

export type NotificationDropdownRef = {
  toggle: () => void;
};

const QUICK_VIEW_SIZE = 20;

/** Where a notification's task lives: the joined task, else event data. */
function taskTarget(notification: InboxNotification) {
  if (notification.task) {
    return {
      projectId: notification.task.projectId,
      taskId: notification.task.id,
    };
  }
  const eventData = getEventDataRecord(notification.eventData);
  const projectId =
    typeof eventData?.projectId === "string" ? eventData.projectId : null;
  return notification.resourceType === "task" &&
    projectId &&
    notification.resourceId
    ? { projectId, taskId: notification.resourceId }
    : null;
}

/**
 * The bell's quick view (B10 §1.5): the active workspace's 20 newest inbox
 * notifications, with a link to the full inbox.
 */
const NotificationDropdown = forwardRef<NotificationDropdownRef>(
  (_props, ref) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { data: workspace } = useActiveWorkspace();
    const workspaceId = workspace?.id;
    const { data } = useInboxNotifications({
      workspaceId,
      tab: "all",
      view: "inbox",
      unread: false,
      types: [],
      pageSize: QUICK_VIEW_SIZE,
    });
    const { data: counts } = useInboxCounts(workspaceId);
    const [isOpen, setIsOpen] = useState(false);
    const [showClearDialog, setShowClearDialog] = useState(false);

    const { mutate: markAllAsRead } = useMarkAllNotificationsAsRead();
    const { mutate: clearAll } = useClearNotifications();
    const { mutate: updateState } = useUpdateNotificationState();

    const notifications = workspaceId
      ? flattenInboxPages(data).slice(0, QUICK_VIEW_SIZE)
      : [];
    const unreadCount = workspaceId ? (counts?.unread ?? 0) : 0;
    const hasUnread = notifications.some(isUnread);
    const hasNotifications = notifications.length > 0;

    const handleNotificationClick = useCallback(
      (notification: InboxNotification) => {
        if (isUnread(notification)) {
          updateState({
            id: notification.id,
            change: { action: "read" },
            silent: true,
          });
        }

        const taskWorkspaceId = notification.workspaceId ?? workspaceId;
        const intake = getIntakeNotificationTarget(notification);
        if (intake && taskWorkspaceId) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/intake",
            params: {
              workspaceId: taskWorkspaceId,
              projectId: intake.projectId,
            },
            search: { tab: "closed", item: intake.itemId },
          });
          return;
        }
        const page = getPageNotificationTarget(notification);
        if (page && taskWorkspaceId) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
            params: { workspaceId: taskWorkspaceId, ...page },
          });
          return;
        }
        const target = taskTarget(notification);
        if (target && taskWorkspaceId) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
            params: { workspaceId: taskWorkspaceId, ...target },
          });
        }
      },
      [navigate, updateState, workspaceId],
    );

    const openInbox = useCallback(() => {
      if (!workspaceId) return;
      setIsOpen(false);
      navigate({
        to: "/dashboard/workspace/$workspaceId/inbox",
        params: { workspaceId },
      });
    }, [navigate, workspaceId]);

    useImperativeHandle(ref, () => ({
      toggle: () => setIsOpen(!isOpen),
    }));

    const handleClearAll = () => {
      if (workspaceId) clearAll(workspaceId);
      setShowClearDialog(false);
    };

    useRegisterShortcuts({
      sequentialShortcuts: {
        [shortcuts.notification.prefix]: {
          [shortcuts.notification.open]: () => setIsOpen(!isOpen),
          [shortcuts.notification.inbox]: openInbox,
        },
      },
    });

    return (
      <>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-sidebar transition-[scale,opacity] duration-200 ease-out starting:scale-75 starting:opacity-0 motion-reduce:starting:scale-100">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                    <span className="sr-only">
                      {t("navigation:notifications")}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex items-center gap-2">
                  <KbdSequence
                    keys={[
                      shortcuts.notification.prefix,
                      shortcuts.notification.open,
                    ]}
                    description={t("notifications:shortcuts.open")}
                  />
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenuContent align="end" className="w-88 p-0">
            <div className="overflow-hidden rounded-lg">
              <div className="flex h-10 items-center justify-between border-border/50 border-b pr-2 pl-3">
                <h3 className="font-medium text-sm">
                  {t("notifications:title")}
                </h3>
                {hasUnread && workspaceId && (
                  <DropdownMenuItem
                    closeOnClick={false}
                    onClick={() =>
                      markAllAsRead({
                        workspaceId,
                        tab: "all",
                        view: "inbox",
                        types: [],
                      })
                    }
                    className="min-h-0 w-auto cursor-pointer rounded-md px-1.5 py-1 text-muted-foreground text-xs sm:min-h-0 sm:text-xs data-highlighted:text-foreground"
                  >
                    {t("common:actions.markAllRead")}
                  </DropdownMenuItem>
                )}
              </div>

              <div className="relative max-h-80 overflow-y-auto p-1">
                {!hasNotifications ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <Bell className="mb-1 size-5 text-muted-foreground/40" />
                    <p className="text-muted-foreground text-sm">
                      {t("notifications:inbox.dropdown.emptyTitle")}
                    </p>
                    <p className="text-muted-foreground/60 text-xs">
                      {t("notifications:inbox.dropdown.emptySubtitle")}
                    </p>
                  </div>
                ) : (
                  notifications.map((notification) => {
                    const content = getNotificationContent(notification, t);
                    const unread = isUnread(notification);
                    return (
                      <DropdownMenuItem
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className="cursor-pointer items-start rounded-md px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "truncate text-sm transition-colors duration-150",
                                unread
                                  ? "font-medium text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {getNotificationTitle(notification, t)}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
                              {formatRelativeTime(notification.sortAt)}
                            </span>
                            {unread && (
                              <span className="size-1.5 shrink-0 rounded-full bg-info" />
                            )}
                          </div>
                          {content && (
                            <p
                              className={cn(
                                "mt-0.5 line-clamp-1 text-xs transition-colors duration-150",
                                unread
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/60",
                              )}
                            >
                              {content}
                            </p>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </div>
              {workspaceId && (
                <div className="flex flex-col border-border/50 border-t p-1">
                  <DropdownMenuItem
                    onClick={openInbox}
                    className="min-h-0 cursor-pointer justify-center rounded-md px-2 py-1 text-muted-foreground text-xs sm:min-h-0 sm:text-xs data-highlighted:text-foreground"
                  >
                    <Inbox className="size-3.5" />
                    {t("notifications:inbox.dropdown.openInbox")}
                  </DropdownMenuItem>
                  {hasNotifications && (
                    <DropdownMenuItem
                      onClick={() => setShowClearDialog(true)}
                      className="min-h-0 cursor-pointer justify-center rounded-md px-2 py-1 text-muted-foreground/70 text-xs sm:min-h-0 sm:text-xs data-highlighted:text-destructive"
                    >
                      {t("notifications:clearAll")}
                    </DropdownMenuItem>
                  )}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("notifications:clearDialogTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("notifications:clearDialogDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                {t("common:actions.cancel")}
              </AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleClearAll}
                  />
                }
              >
                {t("common:actions.clearAll")}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  },
);

NotificationDropdown.displayName = "NotificationDropdown";

export default NotificationDropdown;
