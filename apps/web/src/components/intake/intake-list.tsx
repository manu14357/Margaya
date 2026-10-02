import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { IntakeItem } from "@/types/intake";
import IntakeListRow from "./intake-list-row";

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];

type IntakeListProps = {
  items: IntakeItem[];
  selectedId: string | undefined;
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onSelect: (item: IntakeItem) => void;
  /** Shown when the list is empty. */
  empty: ReactNode;
};

/** The request list: skeleton, error, empty state or rows with Load more. */
export default function IntakeList({
  items,
  selectedId,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onSelect,
  empty,
}: IntakeListProps) {
  const { t } = useTranslation();

  // Keyboard selection keeps the selected row in view.
  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`[data-intake-item-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  if (isLoading) {
    return (
      <div aria-hidden="true" data-testid="intake-list-skeleton">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="border-border/60 border-b px-3 py-2.5">
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (isError && items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          {t("intake:list.loadError")}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("intake:list.retry")}
        </Button>
      </div>
    );
  }

  if (items.length === 0) return <>{empty}</>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul aria-label={t("intake:list.aria")}>
        {items.map((item) => (
          <IntakeListRow
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {hasNextPage && (
        <div className="flex justify-center py-3">
          {isFetchingNextPage ? (
            <Spinner className="size-4 text-muted-foreground" />
          ) : (
            <Button variant="ghost" size="xs" onClick={onLoadMore}>
              {t("intake:list.loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
