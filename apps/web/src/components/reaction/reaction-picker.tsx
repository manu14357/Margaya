import { SmilePlus } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { REACTIONS, type ReactionKey } from "@/lib/reactions";
import type { ReactionGroup } from "@/types/reaction";

type ReactionPickerProps = {
  groups: readonly ReactionGroup[];
  onPick: (emoji: ReactionKey, reacted: boolean) => void;
  triggerClassName?: string;
};

/** The "add reaction" button and its row of the eight reactions. */
export default function ReactionPicker({
  groups,
  onPick,
  triggerClassName,
}: ReactionPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const mine = new Set(
    groups.filter((group) => group.reacted).map((group) => group.emoji),
  );

  // Arrow keys move between the reactions; Enter or Space toggles one.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = buttons.current.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next = (current + step + REACTIONS.length) % REACTIONS.length;
    buttons.current[next]?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("activity:reactions.add")}
              className={cn(
                "rounded-full text-muted-foreground hover:text-foreground",
                triggerClassName,
              )}
            >
              <SmilePlus className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{t("activity:reactions.add")}</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-auto p-1">
        <div
          role="toolbar"
          aria-label={t("activity:reactions.picker")}
          className="flex items-center gap-0.5"
          onKeyDown={handleKeyDown}
        >
          {REACTIONS.map((reaction, index) => {
            const reacted = mine.has(reaction.key);
            return (
              <Button
                key={reaction.key}
                ref={(node: HTMLButtonElement | null) => {
                  buttons.current[index] = node;
                }}
                variant="ghost"
                size="icon-sm"
                aria-label={t(reaction.labelKey)}
                aria-pressed={reacted}
                className={cn("text-base", reacted && "bg-accent")}
                onClick={() => {
                  onPick(reaction.key, reacted);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
