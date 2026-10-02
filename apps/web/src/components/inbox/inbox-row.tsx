import { AlarmClock, Bell } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { isUnread } from "@/lib/inbox-cache";
import {
  getNotificationActorName,
  getNotificationPreview,
  getNotificationTitle,
  getNotificationVerb,
  getPageMentionTitle,
  isSystemNotification,
} from "@/lib/notification-text";
import { formatSnoozeTarget } from "@/lib/snooze-presets";
import type { InboxNotification, InboxView } from "@/types/notification";
import InboxRowActions, { type InboxActionHandler } from "./inbox-row-actions";

const REMINDER_TYPES = new Set(["due_date_reminder", "task_overdue"]);

function LeadingVisual({
  notification,
  actorName,
}: {
  notification: InboxNotification;
  actorName: string | null;
}) {
  if (notification.actor || actorName) {
    return (
      <Avatar className="size-7 shrink-0">
        <AvatarImage
          src={notification.actor?.image ?? ""}
          alt={actorName ?? ""}
        />
        <AvatarFallback className="bg-muted font-medium text-[10px]">
          {getInitials(actorName)}
        </AvatarFallback>
      </Avatar>
    );
  }
  const Icon = REMINDER_TYPES.has(notification.type) ? AlarmClock : Bell;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </span>
  );
}

type InboxRowProps = {
  notification: InboxNotification;
  view: InboxView;
  selected: boolean;
  onSelect: (
    notification: InboxNotification,
    event: MouseEvent | KeyboardEvent,
  ) => void;
  onAction: InboxActionHandler;
};

/** One notification: who did what on which task, with hover actions. */
export default function InboxRow({
  notification,
  view,
  selected,
  onSelect,
  onAction,
}: InboxRowProps) {
  const { t } = useTranslation();
  const unread = isUnread(notification);
  const system = isSystemNotification(notification);
  const actorName = system ? null : getNotificationActorName(notification);
  const verb = getNotificationVerb(notification, t);
  const preview = getNotificationPreview(notification);
  const task = notification.task;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-notification-id={notification.id}
      onClick={(event) => onSelect(notification, event)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(notification, event);
        }
      }}
      className={cn(
        "group relative flex cursor-pointer gap-3 border-border/60 border-b px-3 py-2.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-accent/60 hover:bg-accent/60",
      )}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="-translate-y-1/2 absolute top-1/2 left-1 size-1.5 rounded-full bg-info"
        />
      )}
      <LeadingVisual notification={notification} actorName={actorName} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm">
            {!system && (
              <span
                className={cn(
                  unread
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {actorName ?? t("notifications:inbox.someone")}{" "}
              </span>
            )}
            <span
              className={cn(
                "text-muted-foreground",
                system && unread && "font-medium text-foreground",
              )}
            >
              {verb}
            </span>
          </p>
          {view === "snoozed" && notification.snoozedUntil ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
              <AlarmClock className="size-3" />
              {t("notifications:inbox.snooze.until", {
                date: formatSnoozeTarget(notification.snoozedUntil),
              })}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground/70">
              {formatRelativeTime(notification.sortAt)}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {task ? (
            <>
              <span className="shrink-0 font-mono text-muted-foreground text-xs">
                {task.key}
              </span>
              <span className="truncate text-sm">{task.title}</span>
            </>
          ) : (
            <span className="truncate text-sm">
              {getPageMentionTitle(notification) ??
                getNotificationTitle(notification, t)}
            </span>
          )}
        </div>
        {preview && (
          <p className="line-clamp-1 text-muted-foreground text-xs">
            {preview}
          </p>
        )}
      </div>
      <InboxRowActions
        notification={notification}
        onAction={onAction}
        className="absolute top-1.5 right-2 rounded-md bg-card px-0.5 opacity-0 shadow-xs transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      />
    </div>
  );
}
