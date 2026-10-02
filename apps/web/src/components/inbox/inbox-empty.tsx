import {
  AlarmClock,
  Archive,
  AtSign,
  Bell,
  CheckCheck,
  ListFilter,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import type { InboxEmptyKind } from "@/lib/inbox-search";

const EMPTY_STATES: Record<
  InboxEmptyKind,
  { icon: LucideIcon; titleKey: string; descriptionKey?: string }
> = {
  all: {
    icon: CheckCheck,
    titleKey: "notifications:inbox.empty.all.title",
    descriptionKey: "notifications:inbox.empty.all.description",
  },
  mentions: {
    icon: AtSign,
    titleKey: "notifications:inbox.empty.mentions.title",
    descriptionKey: "notifications:inbox.empty.mentions.description",
  },
  unread: {
    icon: CheckCheck,
    titleKey: "notifications:inbox.empty.unread.title",
  },
  snoozed: {
    icon: AlarmClock,
    titleKey: "notifications:inbox.empty.snoozed.title",
    descriptionKey: "notifications:inbox.empty.snoozed.description",
  },
  archived: {
    icon: Archive,
    titleKey: "notifications:inbox.empty.archived.title",
    descriptionKey: "notifications:inbox.empty.archived.description",
  },
  filtered: {
    icon: ListFilter,
    titleKey: "notifications:inbox.empty.filtered.title",
  },
};

/** The list's empty state for the current tab, view and filters. */
export function InboxListEmpty({
  kind,
  onClearFilters,
  onOpenMyWork,
}: {
  kind: InboxEmptyKind;
  onClearFilters: () => void;
  /** Inbox zero (All or Unread) points on to Your work. */
  onOpenMyWork?: () => void;
}) {
  const { t } = useTranslation();
  const state = EMPTY_STATES[kind];
  const Icon = state.icon;

  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{t(state.titleKey)}</EmptyTitle>
        {state.descriptionKey && (
          <EmptyDescription>{t(state.descriptionKey)}</EmptyDescription>
        )}
      </EmptyHeader>
      {kind === "filtered" && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            {t("notifications:inbox.filters.clear")}
          </Button>
        </EmptyContent>
      )}
      {(kind === "all" || kind === "unread") && onOpenMyWork && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onOpenMyWork}>
            {t("notifications:inbox.empty.openMyWork")}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/** "Couldn't load notifications", with Retry. */
export function InboxListError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="text-muted-foreground text-sm">
        {t("notifications:inbox.loadError")}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("notifications:inbox.retry")}
      </Button>
    </div>
  );
}

const READER_KEYS = [
  { keys: ["J", "K"], labelKey: "notifications:inbox.shortcuts.move" },
  { keys: ["E"], labelKey: "notifications:inbox.shortcuts.archive" },
  { keys: ["S"], labelKey: "notifications:inbox.shortcuts.snooze" },
  { keys: ["U"], labelKey: "notifications:inbox.shortcuts.read" },
  { keys: ["Enter"], labelKey: "notifications:inbox.shortcuts.open" },
] as const;

/** The reading pane before a notification is selected, with its keys. */
export function InboxPreviewEmpty() {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bell />
        </EmptyMedia>
        <EmptyTitle>{t("notifications:inbox.preview.emptyTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("notifications:inbox.preview.emptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <dl
          aria-label={t("notifications:inbox.shortcuts.label")}
          className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-left text-muted-foreground text-xs"
        >
          {READER_KEYS.map((entry) => (
            <div key={entry.labelKey} className="contents">
              <dt className="flex justify-end gap-1">
                {entry.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd>{t(entry.labelKey)}</dd>
            </div>
          ))}
        </dl>
      </EmptyContent>
    </Empty>
  );
}

/** The selected notification's task was deleted or is out of reach. */
export function InboxPreviewUnavailable() {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bell />
        </EmptyMedia>
        <EmptyTitle>{t("notifications:inbox.preview.unavailable")}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}
