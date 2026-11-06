import { AlarmClock, AlarmClockOff, CalendarClock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  formatSnoozeTarget,
  presetTarget,
  SNOOZE_PRESETS,
} from "@/lib/snooze-presets";
import SnoozeDialog from "./snooze-dialog";

type SnoozeMenuProps = {
  isSnoozed: boolean;
  onSnooze: (until: Date) => void;
  onUnsnooze: () => void;
  triggerClassName?: string;
  /** A key that opens the menu, shown in the tooltip. */
  shortcut?: string;
  /** Opens the menu whenever it changes after mount (a keyboard shortcut). */
  openSignal?: number;
};

/** Snooze presets with their target times, Unsnooze, and Custom…. */
export default function SnoozeMenu({
  isSnoozed,
  onSnooze,
  onUnsnooze,
  triggerClassName,
  shortcut,
  openSignal = 0,
}: SnoozeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Hints and targets count from when the menu opened.
  const [openedAt, setOpenedAt] = useState(() => new Date());
  const label = t("notifications:inbox.actions.snooze");

  // A fresh mount (the reader moved to another notification) must not
  // replay an earlier signal, so only a change after mount opens the menu.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    setOpenedAt(new Date());
    setOpen(true);
  }, [openSignal]);

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) setOpenedAt(new Date());
          setOpen(next);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                className={cn("text-muted-foreground", triggerClassName)}
                onClick={(event) => event.stopPropagation()}
              >
                <AlarmClock />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p className="flex items-center gap-1.5 text-xs">
              {label}
              {shortcut && <Kbd>{shortcut}</Kbd>}
            </p>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-56">
          {isSnoozed && (
            <>
              <DropdownMenuItem onClick={onUnsnooze}>
                <AlarmClockOff />
                {t("notifications:inbox.actions.unsnooze")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {SNOOZE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.key}
              onClick={() => onSnooze(presetTarget(preset, new Date()))}
            >
              {t(preset.labelKey)}
              <span className="ms-auto ps-4 text-muted-foreground text-xs">
                {formatSnoozeTarget(presetTarget(preset, openedAt))}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <CalendarClock />
            {t("notifications:inbox.snooze.custom")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SnoozeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSnooze={onSnooze}
      />
    </>
  );
}
