import { CheckCheck, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { InboxTab } from "@/types/notification";

function CountChip({ count }: { count: number | undefined }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      role="img"
      aria-label={t("notifications:inbox.tabs.unreadAria", { count })}
      className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border/60 px-1 font-medium text-[11px] text-muted-foreground"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

type InboxHeaderProps = {
  tab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  unread: number | undefined;
  unreadMentions: number | undefined;
  canMarkAllRead: boolean;
  isMarkingAllRead: boolean;
  onMarkAllRead: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** The filter and view menus. */
  menus: ReactNode;
};

/** Tabs with unread counts, then the list's actions. */
export default function InboxHeader({
  tab,
  onTabChange,
  unread,
  unreadMentions,
  canMarkAllRead,
  isMarkingAllRead,
  onMarkAllRead,
  isRefreshing,
  onRefresh,
  menus,
}: InboxHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as InboxTab)}
        className="min-w-0 flex-1"
      >
        <TabsList variant="underline" className="h-9 gap-1 py-0">
          <TabsTab
            value="all"
            className="h-7 grow-0 gap-1.5 px-2 text-xs sm:h-7 sm:text-sm"
          >
            {t("notifications:inbox.tabs.all")}
            <CountChip count={unread} />
          </TabsTab>
          <TabsTab
            value="mentions"
            className="h-7 grow-0 gap-1.5 px-2 text-xs sm:h-7 sm:text-sm"
          >
            {t("notifications:inbox.tabs.mentions")}
            <CountChip count={unreadMentions} />
          </TabsTab>
        </TabsList>
      </Tabs>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconAction
          label={t("notifications:inbox.toolbar.markAllRead")}
          onClick={onMarkAllRead}
          disabled={!canMarkAllRead || isMarkingAllRead}
        >
          {isMarkingAllRead ? <Spinner className="size-3.5" /> : <CheckCheck />}
        </IconAction>
        <IconAction
          label={t("notifications:inbox.toolbar.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
        </IconAction>
        {menus}
      </div>
    </div>
  );
}
