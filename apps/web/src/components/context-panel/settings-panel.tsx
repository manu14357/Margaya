import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  FolderKanban,
  ServerCog,
  UserRound,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { authClient } from "@/lib/auth-client";

/**
 * Settings: the top-level areas. Settings pages add their own
 * sub-navigation below these rows through <ContextPanelSlot>.
 */
export function SettingsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: session } = authClient.useSession();
  // Instance admins only; the API re-checks the role on every call.
  const isInstanceAdmin = session?.user?.role === "admin";
  const { data: projects } = useGetProjects({ workspaceId });
  const membersPath = `/dashboard/workspace/${workspaceId}/members`;

  return (
    <PanelSection>
      <PanelLink
        label={t("settings:account")}
        icon={UserRound}
        active={pathname.startsWith("/dashboard/settings/account")}
        onSelect={() =>
          navigate({ to: "/dashboard/settings/account/information" })
        }
      />
      <PanelLink
        label={t("navigation:page.settingsWorkspaceTab")}
        icon={Building2}
        active={pathname.startsWith("/dashboard/settings/workspace")}
        onSelect={() =>
          navigate({ to: "/dashboard/settings/workspace/general" })
        }
      />
      {workspaceId && (
        <PanelLink
          label={t("navigation:sidebar.members")}
          icon={Users}
          active={pathname === membersPath}
          onSelect={() => navigate({ to: membersPath })}
        />
      )}
      <PanelLink
        label={t("navigation:sidebar.projects")}
        icon={FolderKanban}
        disabled={projects?.length === 0}
        active={pathname.startsWith("/dashboard/settings/projects")}
        onSelect={() => navigate({ to: "/dashboard/settings/projects" })}
      />
      {isInstanceAdmin && (
        <PanelLink
          label={t("navigation:page.settingsInstanceTab")}
          icon={ServerCog}
          active={pathname.startsWith("/dashboard/settings/instance")}
          onSelect={() =>
            navigate({ to: "/dashboard/settings/instance/general" })
          }
        />
      )}
    </PanelSection>
  );
}
