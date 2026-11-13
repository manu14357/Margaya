import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Building2,
  Code,
  Command as CommandIcon,
  FolderPlus,
  Keyboard,
  LogOut,
  MessageSquareHeart,
  MonitorDown,
  PanelsLeftRight,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  StickyNote,
} from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  openCommandPalette,
  requestCreate,
} from "@/components/command-palette/palette-store";
import { useCustomizeSidebarDialog } from "@/components/common/customize-sidebar-dialog";
import { openFeedbackDialog } from "@/components/feedback/feedback-dialog-store";
import { useFeedbackAvailable } from "@/components/feedback/feedback-host";
import { FocusSubmenu } from "@/components/notification/focus-mode";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { APP_VERSION, CHANGELOG_URL } from "@/components/version-display";
import { shortcuts } from "@/constants/shortcuts";
import {
  DESKTOP_DOWNLOAD_URL,
  DOCS_URL,
  GITHUB_REPOSITORY_URL,
} from "@/constants/urls";
import useSignOut from "@/hooks/mutations/use-sign-out";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { getDesktopShowServers, isDesktopApp } from "@/lib/desktop";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";

type MenuSide = "right" | "top" | "bottom";

type ShellMenuProps = {
  /** The trigger element (a rail button, a tab-bar button). */
  trigger: ReactElement;
  side?: MenuSide;
};

function openShortcutsHelp() {
  // The help dialog listens for "?" on the document.
  setTimeout(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
  }, 50);
}

/** The rail's Create (+) menu: task by default, then project and sticky. */
export function CreateMenu({ trigger, side = "right" }: ShellMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const { data: config } = useGetConfig();
  const { canCreateProjects } = useWorkspacePermission();
  const canCreateWorkspace =
    session?.user?.role === "admin" ||
    (config !== undefined && !config.disableWorkspaceCreation);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        side={side}
        align="end"
        sideOffset={8}
        className="w-max min-w-52 max-w-80"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("navigation:shell.create")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => requestCreate("task")}>
            <SquarePen />
            {t("navigation:shell.newTask")}
            <DropdownMenuShortcut>
              {shortcuts.task.prefix} {shortcuts.task.create}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          {canCreateProjects() && (
            <DropdownMenuItem onClick={() => requestCreate("project")}>
              <FolderPlus />
              {t("navigation:shell.newProject")}
              <DropdownMenuShortcut>
                {shortcuts.project.prefix} {shortcuts.project.create}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!workspace?.id}
            onClick={() => {
              if (!workspace?.id) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/stickies",
                params: { workspaceId: workspace.id },
                search: { new: true },
              });
            }}
          >
            <StickyNote />
            {t("navigation:commandPalette.newSticky")}
          </DropdownMenuItem>
          {canCreateWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => requestCreate("workspace")}>
                <Building2 />
                {t("navigation:shell.newWorkspace")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Help: shortcuts, the command bar, documentation, what's new and the
 * source code (the AGPL-3.0 asks that people using an instance can get it).
 */
export function HelpMenu({ trigger, side = "right" }: ShellMenuProps) {
  const { t } = useTranslation();
  const { data: config } = useGetConfig();
  const sourceUrl = config?.sourceCodeUrl ?? GITHUB_REPOSITORY_URL;
  const feedbackAvailable = useFeedbackAvailable();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        side={side}
        align="end"
        sideOffset={8}
        className="w-max min-w-60 max-w-80"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("navigation:shell.help")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={openShortcutsHelp}>
            <Keyboard />
            {t("navigation:commandPalette.keyboardShortcuts")}
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openCommandPalette()}>
            <CommandIcon />
            {t("navigation:keyboardShortcuts.items.openCommandPalette")}
            <DropdownMenuShortcut>
              {shortcuts.palette.prefix} {shortcuts.palette.open.toUpperCase()}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <BookOpen />
            {t("navigation:shell.documentation")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a
                href={CHANGELOG_URL}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <Sparkles />
            {t("navigation:shell.whatsNew")}
            <DropdownMenuShortcut className="font-mono tracking-normal">
              v{APP_VERSION}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" />
            }
          >
            <Code />
            {t("navigation:shell.sourceCode")}
          </DropdownMenuItem>
          {feedbackAvailable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openFeedbackDialog}>
                <MessageSquareHeart />
                {t("settings:feedback.send.menuItem")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The signed-in person's avatar, as a menu trigger's content. */
export function ShellUserAvatar({ size = "size-8" }: { size?: string }) {
  const { user } = useAuth();
  const initials = getInitials(user?.name || user?.email, "UN");
  return (
    <Avatar className={size}>
      <AvatarImage src={user?.image ?? ""} alt="" />
      <AvatarFallback className="border border-border/30 text-xs">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** The avatar menu: account, settings, theme and sign out. */
export function UserMenu({ trigger, side = "right" }: ShellMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: session } = authClient.useSession();
  const isInstanceAdmin = session?.user?.role === "admin";
  const { data: config } = useGetConfig();
  const { mutateAsync: signOut, isPending } = useSignOut(
    config?.customOAuthLogoutUrl,
  );
  const { setProject } = useProjectStore();
  const openCustomizeSidebar = useCustomizeSidebarDialog(
    (state) => state.setOpen,
  );
  const inDesktopApp = isDesktopApp();
  const showServers = getDesktopShowServers();

  if (!user) return null;

  const handleSignOut = async () => {
    try {
      await signOut();
      setProject(undefined);
      toast.success(t("navigation:userMenu.signedOutSuccess"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("navigation:userMenu.signOutFailed"),
      );
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        side={side}
        align="end"
        sideOffset={8}
        className="w-60"
      >
        <div className="flex items-center gap-2 px-2 py-1.5">
          <ShellUserAvatar size="size-7" />
          <div className="grid min-w-0 flex-1 text-sm leading-tight">
            <span className="truncate font-medium">
              {user.name || t("navigation:userMenu.unnamedUser")}
            </span>
            {user.email && (
              <span className="truncate text-muted-foreground text-xs">
                {user.email}
              </span>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            navigate({ to: "/dashboard/settings/account/information" })
          }
        >
          <Settings />
          {t("navigation:userMenu.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openCustomizeSidebar(true)}>
          <PanelsLeftRight />
          {t("navigation:customize.open")}
        </DropdownMenuItem>
        {!inDesktopApp && (
          <DropdownMenuItem
            render={
              <a
                href={DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MonitorDown />
            {t("navigation:userMenu.getDesktopApp")}
          </DropdownMenuItem>
        )}
        {showServers && (
          <DropdownMenuItem onClick={showServers}>
            <ServerCog />
            {t("navigation:userMenu.switchServer")}
          </DropdownMenuItem>
        )}
        {isInstanceAdmin && (
          <DropdownMenuItem
            onClick={() =>
              navigate({ to: "/dashboard/settings/instance/general" })
            }
          >
            <ShieldCheck />
            {t("navigation:userMenu.instanceSettings")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <FocusSubmenu />
        <DropdownMenuSeparator />
        <ThemeToggleDropdown />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={isPending}>
          <LogOut />
          {isPending
            ? t("navigation:userMenu.signingOut")
            : t("navigation:userMenu.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
