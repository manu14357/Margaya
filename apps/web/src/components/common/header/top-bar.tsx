import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AskButton } from "@/components/ai/ask/ask-button";
import { CommandField } from "@/components/common/header/command-field";
import {
  TopBarDensityProvider,
  useMeasuredTopBarDensity,
} from "@/components/common/header/top-bar-density";
import {
  TopBarMoreMenu,
  TopBarOverflowProvider,
  useTopBarOverflowRegistry,
} from "@/components/common/header/top-bar-overflow";
import { useShell } from "@/components/common/shell-context";
import {
  DESTINATION_META,
  RAIL_BREAKPOINT,
} from "@/components/common/shell-destinations";
import { ShellUserAvatar, UserMenu } from "@/components/common/shell-menus";
import {
  useDesktopDragRegion,
  useDesktopTitleBar,
} from "@/components/desktop/desktop-title-bar";
import NotificationDropdown from "@/components/notification/notification-dropdown";
import { KbdSequence } from "@/components/ui/kbd";
import { SidebarTrigger, useIsBelowWidth } from "@/components/ui/sidebar";
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

/**
 * The 48px bar at the top of every page: the panel toggle, the place, the
 * command field (Ctrl K) and the page's actions. It never wraps: as it
 * narrows (`top-bar-density.ts`) the command field becomes a search icon,
 * the bell steps out, Ask and the page's secondary actions move into a
 * "More" menu (`top-bar-overflow.tsx`), labels drop and the place truncates.
 */
export function TopBar({ title, place, actions, className }: TopBarProps) {
  const { t } = useTranslation();
  // In the desktop app's frameless window this bar is the title bar: its
  // empty space moves the window, the avatar joins it, and it keeps clear of
  // the window buttons (Windows) or the traffic lights (macOS, no rail).
  const titleBar = useDesktopTitleBar();
  const dragRegion = useDesktopDragRegion();
  const { density, barRef, placeRef, trailingRef } = useMeasuredTopBarDensity();
  // Without the rail the drawer's footer holds the account menu.
  const belowRail = useIsBelowWidth(RAIL_BREAKPOINT);
  const full = density === "full";
  const tight = density === "tight";
  const overflow = useTopBarOverflowRegistry();

  return (
    <TopBarDensityProvider value={density}>
      <TopBarOverflowProvider
        registry={overflow.registry}
        items={overflow.items}
      >
        <header
          {...dragRegion}
          ref={barRef}
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 border-border/80 border-b bg-background px-2 md:px-3",
            titleBar &&
              "pe-[calc(var(--desktop-controls-width,0px)+0.5rem)] max-[519px]:ps-[max(0.5rem,var(--desktop-inset-left,0px))] md:pe-[calc(var(--desktop-controls-width,0px)+0.75rem)]",
            className,
          )}
          data-slot="top-bar"
          data-density={density}
        >
          {/*
          Full: both sides grow equally so the command field sits in the
          middle, and from lg up neither side shrinks below its content.
          Compact: the place takes what is left and truncates.
        */}
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5",
              full
                ? "lg:min-w-fit"
                : // The place keeps a little room and clips (its switchers
                  // truncate) instead of sliding under the actions.
                  "-m-1 min-w-18 overflow-hidden p-1",
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarTrigger className="hidden shrink-0 text-muted-foreground hover:text-foreground min-[520px]:inline-flex" />
                }
              />
              <TooltipContent>
                <KbdSequence
                  keys={[shortcuts.sidebar.prefix, shortcuts.sidebar.toggle]}
                  description={t("navigation:shell.togglePanel")}
                />
              </TooltipContent>
            </Tooltip>
            <div
              ref={placeRef}
              className="flex min-w-0 items-center gap-1.5"
              data-slot="top-bar-place"
            >
              {place ??
                (title ? (
                  <>
                    {!tight && <AreaTile />}
                    <h1 className="truncate px-1 font-semibold text-[15px] text-foreground">
                      {title}
                    </h1>
                  </>
                ) : null)}
            </div>
          </div>

          {full && <CommandField />}

          <div
            ref={trailingRef}
            className={cn(
              "flex items-center gap-1.5",
              full
                ? "shrink-0 justify-end md:min-w-0 md:flex-1 lg:min-w-fit"
                : // Last resort on the narrowest windows: the actions scroll
                  // sideways (from the start, so none is out of reach) rather
                  // than slide under the window buttons.
                  "-my-1 min-w-0 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
            data-slot="top-bar-actions"
          >
            {!full && <CommandField compact />}
            {full && <AskButton />}
            {full && (
              <div className="hidden sm:block">
                <NotificationDropdown />
              </div>
            )}
            {actions}
            {/* Crowded: Ask and the page's secondary actions wait in "More". */}
            {!full && !overflow.hosted && (
              <TopBarMoreMenu items={overflow.items} />
            )}
            {titleBar && !belowRail && (
              <UserMenu
                side="bottom"
                trigger={
                  <button
                    type="button"
                    aria-label={t("navigation:shell.account")}
                    className="ms-1 shrink-0 cursor-pointer rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    data-slot="top-bar-account"
                  >
                    <ShellUserAvatar size="size-7" />
                  </button>
                }
              />
            )}
          </div>
        </header>
      </TopBarOverflowProvider>
    </TopBarDensityProvider>
  );
}
