import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import TrashRow, { type TrashRowItem } from "./trash-row";

type TrashListProps = {
  items: TrashRowItem[];
  icon: ReactNode;
  canAct: boolean;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  search: string;
  searchLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  errorText: string;
  onSearchChange: (value: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onRestore: (item: TrashRowItem) => void;
  onPurge: (item: TrashRowItem) => void;
};

/** A searchable trash list with loading, empty and error states. */
export default function TrashList({
  items,
  icon,
  canAct,
  isPending,
  isError,
  hasNextPage,
  isFetchingNextPage,
  search,
  searchLabel,
  emptyTitle,
  emptyDescription,
  errorText,
  onSearchChange,
  onRetry,
  onLoadMore,
  onRestore,
  onPurge,
}: TrashListProps) {
  const { t } = useTranslation();

  let body: ReactNode;
  if (isPending) {
    body = (
      <div className="divide-y divide-border/50" aria-busy="true">
        {["one", "two", "three"].map((key) => (
          <div key={key} className="flex h-11 items-center gap-3 px-4">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <div className="flex items-center gap-3 px-4 py-6 text-muted-foreground text-sm">
        <span>{errorText}</span>
        <Button variant="outline" size="xs" onClick={onRetry}>
          {t("settings:trash.retry")}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trash2 />
          </EmptyMedia>
          <EmptyTitle>
            {search.trim() ? t("settings:trash.noMatches") : emptyTitle}
          </EmptyTitle>
          {!search.trim() && (
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          )}
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <>
        <ul>
          {items.map((item) => (
            <TrashRow
              key={item.id}
              item={item}
              icon={icon}
              canAct={canAct}
              onRestore={() => onRestore(item)}
              onPurge={() => onPurge(item)}
            />
          ))}
        </ul>
        {hasNextPage && (
          <div className="px-4 py-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              loading={isFetchingNextPage}
              onClick={onLoadMore}
            >
              {t("settings:trash.loadMore")}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={search}
        aria-label={searchLabel}
        placeholder={searchLabel}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div className="overflow-hidden rounded-lg border border-border">
        {body}
      </div>
    </div>
  );
}
