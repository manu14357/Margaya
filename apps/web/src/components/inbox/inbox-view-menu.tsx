import { EllipsisVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { INBOX_VIEWS, type InboxView } from "@/types/notification";

const VIEW_LABEL_KEYS: Record<InboxView, string> = {
  inbox: "notifications:inbox.views.inbox",
  snoozed: "notifications:inbox.views.snoozed",
  archived: "notifications:inbox.views.archived",
};

type InboxViewMenuProps = {
  view: InboxView;
  onViewChange: (view: InboxView) => void;
};

/** Inbox, Snoozed or Archived. */
export default function InboxViewMenu({
  view,
  onViewChange,
}: InboxViewMenuProps) {
  const { t } = useTranslation();
  const label = t("notifications:inbox.views.label");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              className="text-muted-foreground"
            >
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view}
            onValueChange={(value) => onViewChange(value as InboxView)}
          >
            {INBOX_VIEWS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {t(VIEW_LABEL_KEYS[option])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
