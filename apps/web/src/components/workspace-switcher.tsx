import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
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
import { shortcuts } from "@/constants/shortcuts";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaces from "@/hooks/queries/workspace/use-get-workspaces";
import {
  getModifierKeyText,
  useRegisterShortcuts,
} from "@/hooks/use-keyboard-shortcuts";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import type { Workspace } from "@/types/workspace";
import CreateWorkspaceModal from "./shared/modals/create-workspace-modal";

/** A squircle with the workspace logo, or its initials. */
export function WorkspaceTile({
  name,
  logo,
  className,
}: {
  name?: string | null;
  logo?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[28%] border border-border/80 bg-primary font-semibold text-primary-foreground text-sm",
        className,
      )}
    >
      {logo ? (
        <img src={logo} alt="" className="size-full object-cover" />
      ) : (
        getInitials(name ?? "", "WS").slice(0, 2)
      )}
    </span>
  );
}

type WorkspaceSwitcherProps = {
  /** "rail": a tile on the rail; "row": a full-width row (mobile drawer). */
  variant?: "rail" | "row";
};

/** The workspace tile at the top of the rail (or a row in the drawer). */
export function WorkspaceSwitcher({
  variant = "rail",
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();

  const { data: workspaces } = useGetWorkspaces();
  const { data: session } = authClient.useSession();
  const { data: config } = useGetConfig();
  const isAdmin = session?.user?.role === "admin";
  const canCreateWorkspace =
    isAdmin || (config !== undefined && !config.disableWorkspaceCreation);
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isCreateWorkspaceModalOpen, setIsCreateWorkspaceModalOpen] =
    React.useState(false);
  const [isSwitching, setIsSwitching] = React.useState(false);

  const handleWorkspaceChange = React.useCallback(
    async (selectedWorkspace: Workspace) => {
      if (isSwitching) return;

      setIsSwitching(true);
      try {
        await authClient.organization.setActive({
          organizationId: selectedWorkspace.id,
        });

        setTimeout(() => {
          navigate({
            to: "/dashboard/workspace/$workspaceId",
            params: { workspaceId: selectedWorkspace.id },
          });
        }, 50);
      } catch (error) {
        console.error("Failed to switch workspace:", error);
      } finally {
        setTimeout(() => setIsSwitching(false), 100);
      }
    },
    [navigate, isSwitching],
  );

  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!workspaces || workspaces.length === 0) return;

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key >= "1" &&
        event.key <= "9"
      ) {
        event.preventDefault();
        const index = Number.parseInt(event.key, 10) - 1;
        if (index < workspaces.length) {
          handleWorkspaceChange(workspaces[index]);
          setIsOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, workspaces, handleWorkspaceChange]);

  useRegisterShortcuts({
    sequentialShortcuts:
      variant === "rail"
        ? {
            [shortcuts.workspace.prefix]: {
              [shortcuts.workspace.switch]: () => {
                setIsOpen(true);
              },
              [shortcuts.workspace.create]: () => {
                if (canCreateWorkspace) {
                  setIsCreateWorkspaceModalOpen(true);
                }
              },
            },
          }
        : {},
  });

  if (!workspace) {
    return variant === "rail" ? (
      <span className="size-9 shrink-0 rounded-[28%] bg-sidebar-accent" />
    ) : null;
  }

  const switchLabel = t("navigation:shell.switchWorkspace", {
    name: workspace.name,
  });

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          render={
            variant === "rail" ? (
              <button
                type="button"
                aria-label={switchLabel}
                title={workspace.name}
                className={cn(
                  "rounded-[28%] outline-hidden transition-transform focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
                  isSwitching && "opacity-50",
                )}
              />
            ) : (
              <button
                type="button"
                aria-label={switchLabel}
                className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
              />
            )
          }
        >
          <WorkspaceTile
            name={workspace.name}
            logo={workspace.logo}
            className={variant === "row" ? "size-7" : undefined}
          />
          {variant === "row" && (
            <>
              <span className="min-w-0 flex-1 truncate font-medium text-sm">
                {workspace.name}
              </span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-56"
          align="start"
          side={variant === "rail" ? "right" : "bottom"}
          sideOffset={8}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t("navigation:workspaceSwitcher.workspaces")}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {workspaces?.map((ws: Workspace, index: number) => (
            <DropdownMenuItem
              key={ws.id}
              onClick={() => {
                if (!isSwitching && ws.id !== workspace.id) {
                  handleWorkspaceChange(ws);
                  setIsOpen(false);
                }
              }}
              disabled={isSwitching || ws.id === workspace.id}
              className="h-7 gap-2 text-sm"
            >
              <WorkspaceTile
                name={ws.name}
                logo={ws.logo}
                className="size-5 border-0 text-[9px]"
              />
              <span className="flex-1 truncate text-left">
                {isSwitching && ws.id === workspace?.id
                  ? t("navigation:workspaceSwitcher.switching")
                  : ws.name}
              </span>
              <DropdownMenuShortcut>
                {getModifierKeyText()} {index > 8 ? "0" : index + 1}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}

          {canCreateWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setIsCreateWorkspaceModalOpen(true);
                  setIsOpen(false);
                }}
                className="h-7 text-sm"
              >
                <span>{t("navigation:workspaceSwitcher.addWorkspace")}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceModal
        open={isCreateWorkspaceModalOpen}
        onClose={() => setIsCreateWorkspaceModalOpen(false)}
      />
    </>
  );
}
