import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { AppRail } from "@/components/app-rail";
import { CustomizeSidebarDialog } from "@/components/common/customize-sidebar-dialog";
import MobileTabBar from "@/components/common/mobile-tab-bar";
import { ShellContext } from "@/components/common/shell-context";
import {
  destinationPath,
  projectIdFromPath,
  resolveDestination,
  type ShellDestination,
} from "@/components/common/shell-destinations";
import { ContextPanel } from "@/components/context-panel/context-panel";
import { DemoAlert } from "@/components/demo-alert";
import { useDesktopShellFrame } from "@/components/desktop/desktop-title-bar";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import WorkspaceDeletionBanner from "@/components/workspace/workspace-deletion-banner";
import { isProjectFeatureEnabled } from "@/constants/project-features";
import { shortcuts } from "@/constants/shortcuts";
import { isDemoMode } from "@/constants/urls";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useUserWebSocket } from "@/hooks/use-user-websocket";
import { useUserPreferencesStore } from "@/store/user-preferences";

/**
 * The authenticated app shell, mounted once by the dashboard route:
 *
 *   rail (64px, from 520px) | context panel (248px, pinned on lg+, a
 *   drawer below)
 *   | main column (pages render their own TopBar, tabs and content)
 *   + a bottom tab bar under 520px (`RAIL_BREAKPOINT`).
 *
 * Pages never render the shell themselves; they render a page frame
 * (Layout / WorkspaceLayout / ProjectLayout, see components/common/README.md).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarDefaultOpen, setSidebarDefaultOpen } =
    useUserPreferencesStore();

  // User-scoped WebSocket (notifications, exports, Home): the shell is
  // mounted for the whole authenticated dashboard, so it owns the socket.
  useUserWebSocket();
  // In the desktop app's frameless window, the top bar is the title bar.
  useDesktopShellFrame();

  return (
    <SidebarProvider
      open={sidebarDefaultOpen}
      onOpenChange={setSidebarDefaultOpen}
      className="min-h-0 overflow-hidden bg-background"
    >
      <ShellFrame>{children}</ShellFrame>
    </SidebarProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: projects } = useGetProjects({ workspaceId });
  const { isMobile, open, setOpen, setOpenMobile, toggleSidebar } =
    useSidebar();
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const [mainColumn, setMainColumn] = useState<HTMLElement | null>(null);
  // A rail choice without a page of its own (Pages with no project to open)
  // shows its panel until the next navigation.
  const [override, setOverride] = useState<{
    destination: ShellDestination;
    pathname: string;
  } | null>(null);

  const destination =
    override && override.pathname === pathname
      ? override.destination
      : resolveDestination(pathname);

  const showPanel = useCallback(() => {
    if (isMobile) setOpenMobile(true);
    else if (!open) setOpen(true);
  }, [isMobile, open, setOpen, setOpenMobile]);

  const selectDestination = useCallback(
    (next: ShellDestination) => {
      if (next === destination) {
        toggleSidebar();
        return;
      }
      if (!workspaceId) return;
      setOpenMobile(false);

      if (next !== "pages") {
        setOverride(null);
        navigate({ to: destinationPath(next, workspaceId) });
        return;
      }

      // Pages live in projects: open the current project's pages, else the
      // first project with Pages on, else just show the panel.
      const withPages = (projects ?? []).filter((project) =>
        isProjectFeatureEnabled(project, "pages"),
      );
      const currentId = projectIdFromPath(pathname);
      const target =
        withPages.find((project) => project.id === currentId) ?? withPages[0];
      if (target) {
        setOverride(null);
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/pages",
          params: { workspaceId, projectId: target.id },
        });
        return;
      }
      setOverride({ destination: "pages", pathname });
      showPanel();
    },
    [
      destination,
      navigate,
      pathname,
      projects,
      setOpenMobile,
      showPanel,
      toggleSidebar,
      workspaceId,
    ],
  );

  useRegisterShortcuts({
    modifierShortcuts: {
      [shortcuts.sidebar.prefix]: {
        [shortcuts.sidebar.toggle]: toggleSidebar,
      },
    },
  });

  const contextValue = useMemo(
    () => ({ destination, selectDestination, panelSlot, mainColumn }),
    [destination, selectDestination, panelSlot, mainColumn],
  );

  return (
    <ShellContext.Provider value={contextValue}>
      <AppRail />
      <ContextPanel onSlotChange={setPanelSlot} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Clear of the desktop app's window buttons (0 in a browser). */}
        <div className="pe-(--desktop-controls-width,0px)">
          {isDemoMode && <DemoAlert />}
          {workspaceId && <WorkspaceDeletionBanner workspaceId={workspaceId} />}
        </div>
        <main
          ref={setMainColumn}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          data-slot="shell-main"
        >
          {children}
        </main>
        <MobileTabBar />
      </div>
      <CustomizeSidebarDialog />
    </ShellContext.Provider>
  );
}
