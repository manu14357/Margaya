import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { InboxFilters, InboxType } from "@/types/notification";
import { INBOX_TYPE_LABEL_KEYS } from "./inbox-filter-menu";

/** A removable chip in the look of the board's active filter chips. */
function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-border bg-background text-xs shadow-xs">
      <span className="px-2 font-medium text-foreground">{label}</span>
      <span className="h-full w-px bg-border" />
      <button
        type="button"
        aria-label={t("notifications:inbox.filters.remove", { name: label })}
        onClick={onRemove}
        className="relative inline-flex h-full w-6 items-center justify-center rounded-r-md text-foreground/70 hover:bg-accent/70 hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

type InboxAppliedFiltersProps = {
  filters: InboxFilters;
  onToggleType: (type: InboxType) => void;
  onToggleUnread: () => void;
  onClearFilters: () => void;
  onBackToInbox: () => void;
};

/** Active filters and a non-inbox view's banner; hidden when neither. */
export default function InboxAppliedFilters({
  filters,
  onToggleType,
  onToggleUnread,
  onClearFilters,
  onBackToInbox,
}: InboxAppliedFiltersProps) {
  const { t } = useTranslation();
  const hasFilters = filters.unread || filters.types.length > 0;
  const otherView = filters.view !== "inbox";

  if (!hasFilters && !otherView) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-border border-b px-2 py-1.5">
      {otherView && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1 text-muted-foreground text-xs">
          <span>
            {filters.view === "snoozed"
              ? t("notifications:inbox.viewing.snoozed")
              : t("notifications:inbox.viewing.archived")}
          </span>
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs"
            onClick={onBackToInbox}
          >
            {t("notifications:inbox.viewing.back")}
          </Button>
        </div>
      )}
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1">
          {filters.types.map((type) => (
            <FilterChip
              key={type}
              label={t(INBOX_TYPE_LABEL_KEYS[type])}
              onRemove={() => onToggleType(type)}
            />
          ))}
          {filters.unread && (
            <FilterChip
              label={t("notifications:inbox.filters.unreadChip")}
              onRemove={onToggleUnread}
            />
          )}
          <Button
            variant="link"
            size="xs"
            className="h-auto px-1 text-muted-foreground text-xs"
            onClick={onClearFilters}
          >
            {t("notifications:inbox.filters.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}
