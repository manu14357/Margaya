import { Archive, ArchiveRestore, Mail, MailOpen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { isUnread } from "@/lib/inbox-cache";
import type {
  InboxNotification,
  NotificationStateAction,
} from "@/types/notification";
import SnoozeMenu from "./snooze-menu";

export type InboxActionHandler = (
  notification: InboxNotification,
  change: NotificationStateAction,
) => void;

function ActionButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  /** The reader's key for this action, shown in the tooltip. */
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1.5 text-xs">
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

type InboxRowActionsProps = {
  notification: InboxNotification;
  onAction: InboxActionHandler;
  /** The preview header shows archive and snooze only. */
  showReadToggle?: boolean;
  /** The reader's header: name the E and S keys in the tooltips. */
  showShortcuts?: boolean;
  /** Bumped to open the snooze menu (the reader's S key). */
  snoozeSignal?: number;
  className?: string;
};

/** Read or unread, archive or move to inbox, and snooze one notification. */
export default function InboxRowActions({
  notification,
  onAction,
  showReadToggle = true,
  showShortcuts = false,
  snoozeSignal,
  className,
}: InboxRowActionsProps) {
  const { t } = useTranslation();
  const unread = isUnread(notification);
  const archived = Boolean(notification.archivedAt);

  return (
    // Menus and the snooze dialog render in portals but bubble through
    // here in React; the row must not treat them as a selection.
    // biome-ignore lint/a11y/noStaticElementInteractions: stops bubbling only
    <div
      className={cn("flex items-center gap-0.5", className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {showReadToggle && (
        <ActionButton
          label={
            unread
              ? t("notifications:inbox.actions.markRead")
              : t("notifications:inbox.actions.markUnread")
          }
          onClick={() =>
            onAction(notification, { action: unread ? "read" : "unread" })
          }
        >
          {unread ? <MailOpen /> : <Mail />}
        </ActionButton>
      )}
      <ActionButton
        label={
          archived
            ? t("notifications:inbox.actions.unarchive")
            : t("notifications:inbox.actions.archive")
        }
        shortcut={showShortcuts ? "E" : undefined}
        onClick={() =>
          onAction(notification, {
            action: archived ? "unarchive" : "archive",
          })
        }
      >
        {archived ? <ArchiveRestore /> : <Archive />}
      </ActionButton>
      <SnoozeMenu
        shortcut={showShortcuts ? "S" : undefined}
        openSignal={snoozeSignal}
        isSnoozed={notification.isSnoozed}
        onSnooze={(until) =>
          onAction(notification, {
            action: "snooze",
            until: until.toISOString(),
          })
        }
        onUnsnooze={() => onAction(notification, { action: "unsnooze" })}
      />
    </div>
  );
}
