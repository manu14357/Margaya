import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CommandField } from "@/components/common/header/command-field";
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
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
              <h1 className="truncate px-1 font-semibold text-[15px] text-foreground">
                {title}
              </h1>
            ) : null)}
        </div>
      </div>

      <CommandField />

      <div className="flex shrink-0 items-center justify-end gap-1.5 md:min-w-0 md:flex-1">
        <div className="hidden sm:block">
          <NotificationDropdown />
        </div>
        {actions}
      </div>
    </header>
  );
}
