import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InboxEmptyKind } from "@/lib/inbox-search";
import type { InboxNotification, InboxView } from "@/types/notification";
import { InboxListEmpty, InboxListError } from "./inbox-empty";
import InboxRow from "./inbox-row";
import type { InboxActionHandler } from "./inbox-row-actions";
import InboxSkeleton from "./inbox-skeleton";

type InboxListProps = {
  rows: InboxNotification[];
  view: InboxView;
  selectedId: string | undefined;
  isLoading: boolean;
  isError: boolean;
  emptyKind: InboxEmptyKind;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onClearFilters: () => void;
  /** Inbox zero's way on: Your work. */
  onOpenMyWork?: () => void;
  onSelect: (
    notification: InboxNotification,
    event: MouseEvent | KeyboardEvent,
  ) => void;
  onAction: InboxActionHandler;
};

/** The scrolling notification list, loading the next page near its end. */
export default function InboxList({
  rows,
  view,
  selectedId,
  isLoading,
  isError,
  emptyKind,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onClearFilters,
  onOpenMyWork,
  onSelect,
  onAction,
}: InboxListProps) {
  const { t } = useTranslation();
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useRef(onLoadMore);
  loadMore.current = onLoadMore;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore.current();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage]);

  // Keyboard selection keeps the selected row in view.
  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector(
      `[data-notification-id="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  if (isLoading) return <InboxSkeleton />;
  if (isError && rows.length === 0) return <InboxListError onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <InboxListEmpty
        kind={emptyKind}
        onClearFilters={onClearFilters}
        onOpenMyWork={onOpenMyWork}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div role="listbox" aria-label={t("notifications:inbox.listLabel")}>
        {rows.map((row) => (
          <InboxRow
            key={row.id}
            notification={row}
            view={view}
            selected={row.id === selectedId}
            onSelect={onSelect}
            onAction={onAction}
          />
        ))}
      </div>
      {hasNextPage && (
        <div ref={sentinel} className="flex justify-center py-3">
          {isFetchingNextPage ? (
            <Spinner className="size-4 text-muted-foreground" />
          ) : (
            <Button variant="ghost" size="xs" onClick={onLoadMore}>
              {t("notifications:inbox.loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
