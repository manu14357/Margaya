import { useLocation, useNavigate } from "@tanstack/react-router";
import { Building2, FolderKanban, ServerCog, UserRound } from "lucide-react";
import {
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import {
  settingsAreaFromPath,
  useSettingsAreaLabels,
} from "@/components/settings/settings-nav";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";

/**
 * Settings: the top-level areas (Members is a page of Workspace). Settings
 * pages add their own sub-navigation below these rows through
 * <ContextPanelSlot>.
 */
export function SettingsPanel({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: session } = authClient.useSession();
  // Instance admins only; the API re-checks the role on every call.
  const isInstanceAdmin = session?.user?.role === "admin";
  const { data: projects } = useGetProjects({ workspaceId });
  const { isGuest } = useWorkspacePermission();
  const labels = useSettingsAreaLabels();
  const area = settingsAreaFromPath(pathname);

  return (
    <PanelSection>
      <PanelLink
        label={labels.account}
        icon={UserRound}
        active={area === "account"}
        onSelect={() =>
          navigate({ to: "/dashboard/settings/account/information" })
        }
      />
      {/* A guest has only their account here (see NotForGuests). */}
      {!isGuest && (
        <>
          <PanelLink
            label={labels.workspace}
            icon={Building2}
            active={area === "workspace"}
            onSelect={() =>
              navigate({ to: "/dashboard/settings/workspace/general" })
            }
          />
          <PanelLink
            label={labels.project}
            icon={FolderKanban}
            disabled={projects?.length === 0}
            active={area === "project"}
            onSelect={() => navigate({ to: "/dashboard/settings/projects" })}
          />
        </>
      )}
      {isInstanceAdmin && (
        <PanelLink
          label={labels.instance}
          icon={ServerCog}
          active={area === "instance"}
          onSelect={() =>
            navigate({ to: "/dashboard/settings/instance/general" })
          }
        />
      )}
    </PanelSection>
  );
}
