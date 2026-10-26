import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AskButton } from "@/components/ai/ask/ask-button";
import { CommandField } from "@/components/common/header/command-field";
import { useShell } from "@/components/common/shell-context";
import { DESTINATION_META } from "@/components/common/shell-destinations";
import NotificationDropdown from "@/components/notification/notification-dropdown";
import { KbdSequence } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcuts } from "@/constants/shortcuts";
import { cn } from "@/lib/cn";

export type TopBarProps = {
  /** The page's name, shown as the place when `place` is not given. */
  title?: ReactNode;
  /**
   * The place cluster (left): e.g. a project tile and switcher. Replaces
   * `title`. Keep it to one line; there are no breadcrumbs.
   */
  place?: ReactNode;
  /** The primary-action slot (right): at most one primary button. */
  actions?: ReactNode;
  className?: string;
};

/**
 * The 48px bar at the top of every page: the panel toggle, the place, the
 * central command field (Ctrl K) and the page's primary action.
 */
/**
 * The current destination's icon on a tile in its area hue, so every titled
 * page (Inbox, Analytics, Settings, …) is marked the same way as the rail.
 */
function AreaTile() {
  const shell = useShell();
  if (!shell) return null;
  const meta = DESTINATION_META[shell.destination];
  const Icon = meta.icon;
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md border"
      style={{
        backgroundColor: `color-mix(in srgb, ${meta.color} 14%, var(--card))`,
        borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)`,
        color: meta.color,
      }}
      data-slot="area-tile"
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </span>
  );
}

export function TopBar({ title, place, actions, className }: TopBarProps) {
  const { t } = useTranslation();

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 md:px-3",
        className,
      )}
      data-slot="top-bar"
    >
      {/*
        Both sides grow equally so the command field sits in the middle, but
        from lg up neither side may shrink below its content: the command
        field gives way instead of painting over the place or the actions.
      */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 lg:min-w-fit">
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarTrigger className="hidden shrink-0 text-muted-foreground hover:text-foreground md:inline-flex" />
            }
          />
          <TooltipContent>
            <KbdSequence
              keys={[shortcuts.sidebar.prefix, shortcuts.sidebar.toggle]}
              description={t("navigation:shell.togglePanel")}
            />
          </TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 items-center gap-1.5">
          {place ??
            (title ? (
              <>
                <AreaTile />
                <h1 className="truncate px-1 font-semibold text-[15px] text-foreground">
                  {title}
                </h1>
              </>
            ) : null)}
        </div>
      </div>

      <CommandField />

      <div className="flex shrink-0 items-center justify-end gap-1.5 md:min-w-0 md:flex-1 lg:min-w-fit">
        <AskButton />
        <div className="hidden sm:block">
          <NotificationDropdown />
        </div>
        {actions}
      </div>
    </header>
  );
}
