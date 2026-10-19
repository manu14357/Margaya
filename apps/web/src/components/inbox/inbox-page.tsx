import { useNavigate } from "@tanstack/react-router";
import type { KeyboardEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SplitView } from "@/components/common/split-view";
import useMarkAllNotificationsAsRead from "@/hooks/mutations/notification/use-mark-all-notifications-as-read";
import useUpdateNotificationState from "@/hooks/mutations/notification/use-update-notification-state";
import useInboxCounts from "@/hooks/queries/notification/use-inbox-counts";
import useInboxNotifications from "@/hooks/queries/notification/use-inbox-notifications";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { flattenInboxPages, isUnread } from "@/lib/inbox-cache";
import {
  type InboxSearch,
  inboxEmptyKind,
  resolveInboxFilters,
  toInboxSearch,
} from "@/lib/inbox-search";
import { toast } from "@/lib/toast";
import type {
  InboxFilters,
  InboxNotification,
  InboxType,
  NotificationStateAction,
} from "@/types/notification";
import InboxAppliedFilters from "./inbox-applied-filters";
import {
  InboxDigestButton,
  InboxDigestPanel,
  useInboxDigest,
} from "./inbox-digest";
import InboxFilterMenu from "./inbox-filter-menu";
import InboxHeader from "./inbox-header";
import InboxList from "./inbox-list";
import InboxPreview from "./inbox-preview";
import InboxViewMenu from "./inbox-view-menu";

type InboxPageProps = {
  workspaceId: string;
  search: InboxSearch;
  /** Merges into the URL search, replacing the history entry. */
  onSearchChange: (patch: Partial<InboxSearch>) => void;
};

function taskHref(workspaceId: string, notification: InboxNotification) {
  const task = notification.task;
  return task
    ? `/dashboard/workspace/${workspaceId}/project/${task.projectId}/task/${task.id}`
    : null;
}

/** Menus and dialogs own the keyboard while they are open. */
function isOverlayFocused() {
  const active = document.activeElement;
  return Boolean(
    active?.closest(
      '[role="dialog"], [role="menu"], [role="listbox"][data-slot="select-list"]',
    ),
  );
}

/**
 * The inbox, a two-pane reader: the notification list, then the selected
 * notification's task in the reading pane. Below 1024px one pane shows at a
 * time; the reader's Back returns to the list. Keys: J/K move, E archives
 * and moves on, S (or H) snoozes, U toggles read, Enter opens the task.
 */
export default function InboxPage({
  workspaceId,
  search,
  onSearchChange,
}: InboxPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const filters = resolveInboxFilters(search);
  const inbox = useInboxNotifications({ workspaceId, ...filters });
  const counts = useInboxCounts(workspaceId);
  const digest = useInboxDigest(workspaceId);
  const rows = useMemo(() => flattenInboxPages(inbox.data), [inbox.data]);
  const { mutate: updateState } = useUpdateNotificationState();
  const markAllRead = useMarkAllNotificationsAsRead();

  // The preview keeps a row that left the list (archived, snoozed, read
  // under "Unread only") until another one is selected.
  const selectedId = search.notificationId;
  const listed = selectedId
    ? rows.find((row) => row.id === selectedId)
    : undefined;
  const [kept, setKept] = useState<InboxNotification | null>(null);
  useEffect(() => {
    if (listed) setKept(listed);
  }, [listed]);
  const selected =
    listed ?? (kept && kept.id === selectedId ? kept : null) ?? null;

  const setFilters = (patch: Partial<InboxFilters>) =>
    onSearchChange(toInboxSearch({ ...filters, ...patch }));

  const toggleType = (type: InboxType) =>
    setFilters({
      types: filters.types.includes(type)
        ? filters.types.filter((value) => value !== type)
        : [...filters.types, type],
    });

  const onAction = useCallback(
    (notification: InboxNotification, change: NotificationStateAction) =>
      updateState({ id: notification.id, change }),
    [updateState],
  );

  const selectRow = useCallback(
    (notification: InboxNotification) => {
      onSearchChange({ notificationId: notification.id });
      if (isUnread(notification)) {
        updateState({
          id: notification.id,
          change: { action: "read" },
          silent: true,
        });
      }
    },
    [onSearchChange, updateState],
  );

  const handleSelect = (
    notification: InboxNotification,
    event: MouseEvent | KeyboardEvent,
  ) => {
    const href = taskHref(workspaceId, notification);
    if ((event.metaKey || event.ctrlKey) && href) {
      window.open(href, "_blank", "noopener");
      return;
    }
    selectRow(notification);
  };

  const closePreview = () => onSearchChange({ notificationId: undefined });

  const openMyWork = () =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/my-work",
      params: { workspaceId },
    });

  const focusRow = (id: string) =>
    document
      .querySelector<HTMLElement>(`[data-notification-id="${CSS.escape(id)}"]`)
      ?.focus();

  const moveSelection = (delta: number) => {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.id === selectedId);
    const nextIndex =
      index === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, index + delta));
    const next = rows[nextIndex];
    if (!next || next.id === selectedId) return;
    selectRow(next);
    focusRow(next.id);
  };

  // E files the open notification away (or back from Archived). It leaves
  // the current list either way, so the reader moves on to its neighbour.
  const archiveSelected = () => {
    if (!selected) return;
    const index = rows.findIndex((row) => row.id === selected.id);
    onAction(selected, {
      action: selected.archivedAt ? "unarchive" : "archive",
    });
    if (index === -1) return;
    const next = rows[index + 1] ?? rows[index - 1];
    if (next) {
      selectRow(next);
      focusRow(next.id);
    } else {
      closePreview();
    }
  };

  // S (and H, as in the spec's reader) opens the reader's snooze menu.
  const [snoozeSignal, setSnoozeSignal] = useState(0);
  const openSnooze = () => {
    if (selected) setSnoozeSignal((current) => current + 1);
  };

  const guard = (run: () => void) => () => {
    if (!isOverlayFocused()) run();
  };

  useRegisterShortcuts({
    shortcuts: {
      j: guard(() => moveSelection(1)),
      k: guard(() => moveSelection(-1)),
      e: guard(archiveSelected),
      s: guard(openSnooze),
      h: guard(openSnooze),
      u: guard(() => {
        if (!selected) return;
        onAction(selected, {
          action: isUnread(selected) ? "read" : "unread",
        });
      }),
    },
  });

  // Arrow keys, Enter and Escape act only while the list has focus, so
  // they never steal keys from buttons, menus or dialogs.
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape" && selectedId) {
      event.preventDefault();
      closePreview();
    } else if (
      event.key === "Enter" &&
      selected?.task &&
      (event.target as HTMLElement).dataset?.notificationId === selectedId
    ) {
      // Enter on the already selected row opens its task's page.
      event.preventDefault();
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
        params: {
          workspaceId,
          projectId: selected.task.projectId,
          taskId: selected.task.id,
        },
      });
    }
  };

  const handleMarkAllRead = () =>
    markAllRead.mutate(
      {
        workspaceId,
        tab: filters.tab,
        view: filters.view,
        types: filters.types,
      },
      {
        onSuccess: (result) =>
          toast.success(
            t("notifications:inbox.toasts.markedAllRead", {
              count: result.updatedCount ?? 0,
            }),
          ),
        onError: () => toast.error(t("notifications:inbox.toasts.error")),
      },
    );

  return (
    <SplitView
      primaryWidth="md"
      primaryLabel={t("notifications:inbox.listLabel")}
      secondaryLabel={t("notifications:inbox.preview.label")}
      showSecondary={Boolean(selected)}
      primary={
        <div className="flex min-h-0 flex-1 flex-col bg-card">
          <InboxHeader
            tab={filters.tab}
            onTabChange={(tab) => setFilters({ tab })}
            unread={counts.data?.unread}
            unreadMentions={counts.data?.unreadMentions}
            canMarkAllRead={rows.some(isUnread)}
            isMarkingAllRead={markAllRead.isPending}
            onMarkAllRead={handleMarkAllRead}
            isRefreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
            onRefresh={() => {
              void inbox.refetch();
              void counts.refetch();
            }}
            menus={
              <>
                <InboxDigestButton
                  digest={digest}
                  unread={counts.data?.unread}
                />
                <InboxFilterMenu
                  types={filters.types}
                  unread={filters.unread}
                  onToggleType={toggleType}
                  onToggleUnread={() => setFilters({ unread: !filters.unread })}
                />
                <InboxViewMenu
                  view={filters.view}
                  onViewChange={(view) => setFilters({ view })}
                />
              </>
            }
          />
          <InboxDigestPanel digest={digest} />
          <InboxAppliedFilters
            filters={filters}
            onToggleType={toggleType}
            onToggleUnread={() => setFilters({ unread: !filters.unread })}
            onClearFilters={() => setFilters({ unread: false, types: [] })}
            onBackToInbox={() => setFilters({ view: "inbox" })}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard navigation of the listbox inside */}
          <div
            className="flex min-h-0 flex-1 flex-col"
            onKeyDown={handleListKeyDown}
          >
            <InboxList
              rows={rows}
              view={filters.view}
              selectedId={selectedId}
              isLoading={inbox.isLoading}
              isError={inbox.isError}
              emptyKind={inboxEmptyKind(filters)}
              hasNextPage={Boolean(inbox.hasNextPage)}
              isFetchingNextPage={inbox.isFetchingNextPage}
              onLoadMore={() => {
                if (!inbox.isFetchingNextPage) void inbox.fetchNextPage();
              }}
              onRetry={() => void inbox.refetch()}
              onClearFilters={() => setFilters({ unread: false, types: [] })}
              onOpenMyWork={openMyWork}
              onSelect={handleSelect}
              onAction={onAction}
            />
          </div>
        </div>
      }
      secondary={
        <InboxPreview
          notification={selected}
          workspaceId={workspaceId}
          onAction={onAction}
          onClose={closePreview}
          snoozeSignal={snoozeSignal}
        />
      }
    />
  );
}
