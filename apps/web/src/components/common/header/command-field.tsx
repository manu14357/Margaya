import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openCommandPalette } from "@/components/command-palette/palette-store";
import { KbdSequence } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcuts } from "@/constants/shortcuts";
import { cn } from "@/lib/cn";

/**
 * The top bar's command field: a button that opens the command palette.
 * Between 15rem and 24rem wide while the bar has room (narrower, its prompt
 * and shortcut would be cut off, so the bar turns compact first); `compact`
 * makes it a search icon that opens the same palette.
 */
export function CommandField({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t("navigation:shell.commandField");

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => openCommandPalette()}
              className={cn(
                "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
              data-slot="command-field-icon"
            />
          }
        >
          <Search aria-hidden className="size-4.5" />
        </TooltipTrigger>
        <TooltipContent>
          <KbdSequence
            keys={[shortcuts.palette.prefix, shortcuts.palette.open]}
            description={label}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts="Control+K Meta+K"
      onClick={() => openCommandPalette()}
      className={cn(
        // Touch: reaches 44px tall through an invisible hit area.
        "relative flex h-8 w-60 min-w-60 cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-input bg-card ps-3 pe-1.5 text-muted-foreground/80 text-sm outline-hidden transition-colors hover:border-ring/40 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:overflow-visible pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px] lg:w-96",
        className,
      )}
      data-slot="command-field"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <kbd className="hidden h-5 shrink-0 items-center rounded border bg-muted px-1.5 font-mono font-medium text-[11px] text-muted-foreground sm:inline-flex">
        {shortcuts.palette.prefix} {shortcuts.palette.open.toUpperCase()}
      </kbd>
    </button>
  );
}
