import { useLocation } from "@tanstack/react-router";
import { CircleQuestionMark, PanelLeftClose, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRailDestinations } from "@/components/app-rail";
import { useShell } from "@/components/common/shell-context";
import {
  DESTINATION_META,
  type ShellDestination,
} from "@/components/common/shell-destinations";
import {
  HelpMenu,
  ShellUserAvatar,
  UserMenu,
} from "@/components/common/shell-menus";
import { AnalyticsPanel } from "@/components/context-panel/analytics-panel";
import { HomePanel } from "@/components/context-panel/home-panel";
import { InboxPanel } from "@/components/context-panel/inbox-panel";
import { MyWorkPanel } from "@/components/context-panel/my-work-panel";
import { PagesPanel } from "@/components/context-panel/pages-panel";
import { ProjectsPanel } from "@/components/context-panel/projects-panel";
import { SettingsPanel } from "@/components/context-panel/settings-panel";
import { TrialCard } from "@/components/trial-card";
import { Button } from "@/components/ui/button";
import { KbdSequence } from "@/components/ui/kbd";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { shortcuts } from "@/constants/shortcuts";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { cn } from "@/lib/cn";

function DestinationBody({
  destination,
  workspaceId,
}: {
  destination: ShellDestination;
  workspaceId: string;
}) {
  switch (destination) {
    case "home":
      return <HomePanel workspaceId={workspaceId} />;
    case "inbox":
      return <InboxPanel workspaceId={workspaceId} />;
    case "my-work":
      return <MyWorkPanel workspaceId={workspaceId} />;
    case "projects":
      return <ProjectsPanel workspaceId={workspaceId} />;
    case "pages":
      return <PagesPanel workspaceId={workspaceId} />;
    case "analytics":
      return <AnalyticsPanel workspaceId={workspaceId} />;
    case "settings":
      return <SettingsPanel workspaceId={workspaceId} />;
  }
}

/** Under 768px the rail is gone; the drawer lists every destination. */
function DrawerDestinations() {
  const { t } = useTranslation();
  const shell = useShell();
  const destinations = useRailDestinations();
  if (!shell) return null;

  return (
    <nav
      aria-label={t("navigation:shell.primary")}
      className="grid grid-cols-4 gap-1 border-b px-2 py-2 md:hidden"
    >
      {[...destinations, "settings" as const].map((id) => {
        const meta = DESTINATION_META[id];
        const Icon = meta.icon;
        const active = shell.destination === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => shell.selectDestination(id)}
            className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md font-medium text-[11px] text-sidebar-foreground outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
          >
            <Icon
              className="size-4.5"
              strokeWidth={1.75}
              style={{ color: meta.color }}
            />
            <span className="max-w-full truncate px-1">{t(meta.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function PanelContents({
  drawer,
  onClose,
  onSlotChange,
}: {
  drawer: boolean;
  onClose: () => void;
  onSlotChange: (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const shell = useShell();
  const { data: workspace } = useActiveWorkspace();
  const slotRef = useRef<HTMLDivElement>(null);

  // Ref callbacks would re-run on every render; report the slot once.
  useEffect(() => {
    onSlotChange(slotRef.current);
    return () => onSlotChange(null);
  }, [onSlotChange]);

  if (!shell) return null;
  const meta = DESTINATION_META[shell.destination];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {drawer && (
        <div className="border-b p-2 md:hidden">
          <WorkspaceSwitcher variant="row" />
        </div>
      )}
      {drawer && <DrawerDestinations />}

      <div className="flex h-12 shrink-0 items-center gap-2 ps-4 pe-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5"
          style={{
            backgroundColor: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
            color: meta.color,
          }}
        >
          <meta.icon strokeWidth={2} />
        </span>
        <h2 className="min-w-0 flex-1 truncate font-semibold text-[15px] text-foreground">
          {t(meta.labelKey)}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("navigation:shell.closePanel")}
                onClick={onClose}
                className="text-muted-foreground"
              />
            }
          >
            {drawer ? <X /> : <PanelLeftClose />}
          </TooltipTrigger>
          <TooltipContent>
            <KbdSequence
              keys={[shortcuts.sidebar.prefix, shortcuts.sidebar.toggle]}
              description={t("navigation:shell.closePanel")}
            />
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
        data-slot="context-panel-body"
      >
        {workspace?.id && (
          <DestinationBody
            destination={shell.destination}
            workspaceId={workspace.id}
          />
        )}
        <div ref={slotRef} data-slot="context-panel-slot" />
      </div>

      <div className="flex shrink-0 flex-col gap-2 p-2 empty:hidden">
        <TrialCard />
        {drawer && (
          <div className="flex items-center justify-between md:hidden">
            <UserMenu
              side="top"
              trigger={
                <button
                  type="button"
                  aria-label={t("navigation:shell.account")}
                  className="rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ShellUserAvatar />
                </button>
              }
            />
            <HelpMenu
              side="top"
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("navigation:shell.help")}
                >
                  <CircleQuestionMark />
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The context panel: only the active destination's navigation. Pinned at
 * 248px from 1024px up (Ctrl B toggles it); below that it is a drawer.
 */
export function ContextPanel({
  onSlotChange,
}: {
  onSlotChange: (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const { isMobile, open, setOpen, openMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });

  // A drawer closes once its row has taken you somewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  if (!isMobile) {
    if (!open) return null;
    return (
      <aside
        aria-label={t("navigation:shell.panel")}
        className="flex w-62 shrink-0 flex-col border-r bg-card text-sidebar-foreground"
        data-slot="context-panel"
      >
        <PanelContents
          drawer={false}
          onClose={() => setOpen(false)}
          onSlotChange={onSlotChange}
        />
      </aside>
    );
  }

  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetPopup
        side="left"
        showCloseButton={false}
        className={cn(
          "w-72 max-w-[86vw] bg-card p-0 text-sidebar-foreground md:ms-16",
        )}
        data-slot="context-panel"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t("navigation:shell.panel")}</SheetTitle>
          <SheetDescription>
            {t("navigation:shell.panelDescription")}
          </SheetDescription>
        </SheetHeader>
        <PanelContents
          drawer
          onClose={() => setOpenMobile(false)}
          onSlotChange={onSlotChange}
        />
      </SheetPopup>
    </Sheet>
  );
}
