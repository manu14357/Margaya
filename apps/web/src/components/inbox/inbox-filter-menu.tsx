import { ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { INBOX_TYPES, type InboxType } from "@/types/notification";

export const INBOX_TYPE_LABEL_KEYS: Record<InboxType, string> = {
  assigned: "notifications:inbox.types.assigned",
  created: "notifications:inbox.types.created",
  subscribed: "notifications:inbox.types.subscribed",
};

type InboxFilterMenuProps = {
  types: InboxType[];
  unread: boolean;
  onToggleType: (type: InboxType) => void;
  onToggleUnread: () => void;
};

/** Relationship filters and "Unread only"; rows keep the menu open. */
export default function InboxFilterMenu({
  types,
  unread,
  onToggleType,
  onToggleUnread,
}: InboxFilterMenuProps) {
  const { t } = useTranslation();
  const active = unread || types.length > 0;
  const label = t("notifications:inbox.toolbar.filters");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              className="relative text-muted-foreground"
            >
              <ListFilter />
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        {INBOX_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={types.includes(type)}
            onCheckedChange={() => onToggleType(type)}
          >
            {t(INBOX_TYPE_LABEL_KEYS[type])}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={unread}
          onCheckedChange={onToggleUnread}
        >
          {t("notifications:inbox.toolbar.unreadOnly")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
