import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openCommandPalette } from "@/components/command-palette/palette-store";
import { shortcuts } from "@/constants/shortcuts";
import { cn } from "@/lib/cn";

/**
 * The top bar's command field: a button that opens the command palette.
 * Full width from 768px, never narrower than 10rem; an icon below that.
 */
export function CommandField({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t("navigation:shell.commandField");

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => openCommandPalette()}
        className={cn(
          "hidden h-8 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-input bg-card ps-3 pe-1.5 text-muted-foreground/80 text-sm outline-hidden transition-colors hover:border-ring/40 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex md:w-60 md:min-w-40 lg:w-96",
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
      <button
        type="button"
        aria-label={label}
        onClick={() => openCommandPalette()}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <Search aria-hidden className="size-4.5" />
      </button>
    </>
  );
}
