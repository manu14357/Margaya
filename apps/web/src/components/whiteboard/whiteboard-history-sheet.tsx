import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetPanel } from "@/components/ui/sheet";
import { SheetHeaderBar } from "@/components/ui/sheet-header-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useWhiteboardActivity } from "@/hooks/queries/whiteboard/use-whiteboard-activity";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import type { WhiteboardActivityEntry } from "@/types/whiteboard";

type WhiteboardHistorySheetProps = {
  whiteboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const ENTRY_KEYS = {
  created: "whiteboards:history.entries.created",
  renamed: "whiteboards:history.entries.renamed",
  icon_changed: "whiteboards:history.entries.iconChanged",
  locked: "whiteboards:history.entries.locked",
  unlocked: "whiteboards:history.entries.unlocked",
  archived: "whiteboards:history.entries.archived",
  unarchived: "whiteboards:history.entries.unarchived",
  published: "whiteboards:history.entries.published",
  unpublished: "whiteboards:history.entries.unpublished",
  trashed: "whiteboards:history.entries.trashed",
  restored: "whiteboards:history.entries.restored",
  edited: "whiteboards:history.entries.edited",
} as const satisfies Record<WhiteboardActivityEntry["action"], string>;

function HistoryRow({ entry }: { entry: WhiteboardActivityEntry }) {
  const { t, i18n } = useTranslation();
  const name = entry.actor?.name || t("whiteboards:history.someone");
  const title = entry.title?.trim() || t("whiteboards:list.untitled");
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Avatar className="size-7 shrink-0">
        {entry.actor?.image && <AvatarImage src={entry.actor.image} alt="" />}
        <AvatarFallback className="text-[10px]">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-sm">{name}</span>
          <time
            dateTime={entry.createdAt}
            title={formatDateTime(entry.createdAt, i18n.language)}
            className="shrink-0 text-muted-foreground text-xs"
          >
            {formatRelativeTime(entry.createdAt, i18n.language)}
          </time>
        </div>
        <p className="text-muted-foreground text-sm">
          {t(ENTRY_KEYS[entry.action], { title })}
        </p>
      </div>
    </li>
  );
}

/** The board's history: lifecycle changes and edits, newest first. */
export default function WhiteboardHistorySheet({
  whiteboardId,
  open,
  onOpenChange,
}: WhiteboardHistorySheetProps) {
  const { t } = useTranslation();
  const activity = useWhiteboardActivity(whiteboardId, { enabled: open });
  const entries = activity.data?.pages.flatMap((page) => page.items) ?? [];

  const body = () => {
    if (activity.isPending) {
      return (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      );
    }
    if (activity.isError && entries.length === 0) {
      return (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-muted-foreground text-sm">
            {t("whiteboards:history.loadError")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void activity.refetch()}
          >
            {t("whiteboards:list.retry")}
          </Button>
        </div>
      );
    }
    if (entries.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("whiteboards:history.empty")}
        </p>
      );
    }
    return (
      <>
        <ol
          aria-label={t("whiteboards:history.title")}
          className="divide-y divide-border/60"
        >
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ol>
        {activity.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            disabled={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            {t("whiteboards:history.loadMore")}
          </Button>
        )}
      </>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeaderBar
          title={t("whiteboards:history.title")}
          description={t("whiteboards:history.description")}
        />
        <SheetPanel>{body()}</SheetPanel>
      </SheetContent>
    </Sheet>
  );
}
