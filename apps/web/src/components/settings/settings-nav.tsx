import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Blocks,
  Building2,
  Code,
  CreditCard,
  FileDown,
  FolderKanban,
  GitBranch,
  Globe,
  KeyRound,
  Mail,
  Plug,
  Ruler,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Trash2,
  User,
  UserRound,
  Webhook,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelHint,
  PanelSection,
  ProjectTile,
} from "@/components/context-panel/panel-primitives";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { INSTANCE_PAGE_PATHS } from "@/lib/instance-settings";

export type SettingsArea = "account" | "workspace" | "project" | "instance";

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  active: boolean;
  disabled?: boolean;
};

const PROJECT_SEGMENTS = [
  "general",
  "features",
  "visibility",
  "integrations",
  "workflow",
  "estimates",
  "trash",
] as const;

/** The settings area a pathname belongs to. */
export function settingsAreaFromPath(pathname: string): SettingsArea {
  if (pathname.startsWith("/dashboard/settings/workspace")) return "workspace";
  if (pathname.startsWith("/dashboard/settings/projects")) return "project";
  if (pathname.startsWith("/dashboard/settings/instance")) return "instance";
  return "account";
}

/** The project id and segment of a project settings pathname. */
export function projectSettingsFromPath(pathname: string) {
  const match = pathname.match(
    /^\/dashboard\/settings\/projects\/([^/]+)(?:\/([^/]+))?/,
  );
  return { projectId: match?.[1] ?? "", segment: match?.[2] ?? "general" };
}

/**
 * Everything the settings navigation shows for the current path: the four
 * areas, the active area's pages and, for project settings, the project.
 */
export function useSettingsNav() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: session } = authClient.useSession();
  // Instance admins only; the API re-checks the role on every call.
  const isInstanceAdmin = session?.user?.role === "admin";
  const { data: workspace } = useActiveWorkspace();
  const { canManageWebhooks, canReadAuditLog, isCheckingPermissions } =
    useWorkspacePermission();
  const { data: config } = useGetConfig();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });

  const area = settingsAreaFromPath(pathname);
  const { projectId, segment } = projectSettingsFromPath(pathname);
  const project = projects?.find((candidate) => candidate.id === projectId);

  const areas: NavItem[] = [
    {
      id: "account",
      label: t("settings:account"),
      icon: UserRound,
      to: "/dashboard/settings/account/information",
      active: area === "account",
    },
    {
      id: "workspace",
      label: t("navigation:page.settingsWorkspaceTab"),
      icon: Building2,
      to: "/dashboard/settings/workspace/general",
      active: area === "workspace",
    },
    {
      id: "project",
      label: t("navigation:sidebar.projects"),
      icon: FolderKanban,
      to: "/dashboard/settings/projects",
      active: area === "project",
      disabled: projects?.length === 0,
    },
    ...(isInstanceAdmin
      ? [
          {
            id: "instance",
            label: t("navigation:page.settingsInstanceTab"),
            icon: ServerCog,
            to: "/dashboard/settings/instance/general",
            active: area === "instance",
          },
        ]
      : []),
  ];

  const exact = (to: string) => pathname === to;
  let items: NavItem[] = [];
  let areaLabel = "";

  if (area === "account") {
    areaLabel = t("settings:account");
    items = [
      {
        id: "information",
        label: t("settings:information"),
        icon: User,
        to: "/dashboard/settings/account/information",
      },
      {
        id: "notifications",
        label: t("settings:notifications"),
        icon: Bell,
        to: "/dashboard/settings/account/notifications",
      },
      {
        id: "preferences",
        label: t("settings:preferences"),
        icon: SlidersHorizontal,
        to: "/dashboard/settings/account/preferences",
      },
      {
        id: "security",
        label: t("settings:security"),
        icon: ShieldCheck,
        to: "/dashboard/settings/account/security",
      },
      {
        id: "developer",
        label: t("settings:apiKeys"),
        icon: Code,
        to: "/dashboard/settings/account/developer",
      },
    ].map((item) => ({ ...item, active: exact(item.to) }));
  } else if (area === "workspace") {
    areaLabel = workspace?.name ?? t("navigation:page.settingsWorkspaceTab");
    const webhooksPath = "/dashboard/settings/workspace/webhooks";
    items = [
      {
        id: "general",
        label: t("settings:workspaceGeneral.title"),
        icon: Settings,
        to: "/dashboard/settings/workspace/general",
      },
      {
        id: "roles",
        label: t("settings:workspaceRoles.title"),
        icon: Shield,
        to: "/dashboard/settings/workspace/roles",
      },
      {
        id: "labels",
        label: t("settings:workspaceLabels.title"),
        icon: Tag,
        to: "/dashboard/settings/workspace/labels",
      },
      ...(!isCheckingPermissions && canManageWebhooks()
        ? [
            {
              id: "webhooks",
              label: t("settings:workspaceWebhooks.title"),
              icon: Webhook,
              to: webhooksPath,
            },
          ]
        : []),
      {
        id: "exports",
        label: t("settings:workspaceExports.title"),
        icon: FileDown,
        to: "/dashboard/settings/workspace/exports",
      },
      {
        id: "trash",
        label: t("settings:trash.workspaceNav"),
        icon: Trash2,
        to: "/dashboard/settings/workspace/trash",
      },
      ...(!isCheckingPermissions && canReadAuditLog()
        ? [
            {
              id: "audit-log",
              label: t("settings:workspaceAuditLog.title"),
              icon: ScrollText,
              to: "/dashboard/settings/workspace/audit-log",
            },
          ]
        : []),
      ...(config?.billingEnabled
        ? [
            {
              id: "billing",
              label: t("settings:nav.billing"),
              icon: CreditCard,
              to: "/dashboard/settings/workspace/billing",
            },
          ]
        : []),
    ].map((item) => ({
      ...item,
      // Webhooks stays active on a webhook's detail page.
      active:
        exact(item.to) ||
        (item.to === webhooksPath && pathname.startsWith(`${webhooksPath}/`)),
    }));
  } else if (area === "project") {
    areaLabel = project?.name ?? t("navigation:projectSettings.projectLabel");
    const labels: Record<(typeof PROJECT_SEGMENTS)[number], string> = {
      general: t("settings:projectGeneral.title"),
      features: t("settings:projectFeatures.title"),
      visibility: t("settings:projectPublish.title"),
      integrations: t("settings:projectIntegrations.title"),
      workflow: t("settings:projectWorkflow.title"),
      estimates: t("settings:projectEstimates.title"),
      trash: t("settings:trash.projectTitle"),
    };
    const icons: Record<(typeof PROJECT_SEGMENTS)[number], LucideIcon> = {
      general: Settings,
      features: Blocks,
      visibility: Globe,
      integrations: Plug,
      workflow: GitBranch,
      estimates: Ruler,
      trash: Trash2,
    };
    items = PROJECT_SEGMENTS.map((id) => ({
      id,
      label: labels[id],
      icon: icons[id],
      to: project
        ? `/dashboard/settings/projects/${project.id}/${id}`
        : "/dashboard/settings/projects",
      active: Boolean(project) && segment === id,
      disabled: !project,
    }));
  } else {
    areaLabel =
      config?.instanceName ?? t("navigation:page.settingsInstanceTab");
    const instancePages = [
      ["general", Settings, "instanceAdmin:nav.general"],
      ["authentication", KeyRound, "instanceAdmin:nav.authentication"],
      ["email", Mail, "instanceAdmin:nav.email"],
      ["workspaces", Building2, "instanceAdmin:nav.workspaces"],
      ["publicBoards", Globe, "instanceAdmin:nav.publicBoards"],
      ["admins", ShieldCheck, "instanceAdmin:nav.admins"],
    ] as const;
    items = instancePages.map(([id, icon, labelKey]) => ({
      id,
      label: t(labelKey),
      icon,
      to: INSTANCE_PAGE_PATHS[id],
      active: exact(INSTANCE_PAGE_PATHS[id]),
    }));
  }

  return { area, areas, areaLabel, items, projects, project, segment };
}

type SettingsNavState = ReturnType<typeof useSettingsNav>;

function ProjectPicker({
  nav,
  className,
}: {
  nav: SettingsNavState;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, project, segment } = nav;
  const nextSegment = (PROJECT_SEGMENTS as readonly string[]).includes(segment)
    ? segment
    : "general";

  return (
    <Select
      value={project?.id ?? ""}
      onValueChange={(projectId) => {
        if (!projectId) return;
        void navigate({
          to: `/dashboard/settings/projects/${projectId}/${nextSegment}`,
        });
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("navigation:projectSettings.projectLabel")}
        className={cn("font-normal", className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {project && <ProjectTile icon={project.icon} />}
          <span className="truncate text-foreground">
            {project?.name ||
              (projects && projects.length === 0
                ? t("settings:projectSwitcher.noProjects")
                : t("settings:projectSwitcher.selectProject"))}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="start"
        sideOffset={6}
        alignItemWithTrigger={false}
        className="w-(--anchor-width) min-w-56"
      >
        {projects?.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            <span className="flex min-w-0 items-center gap-2">
              <ProjectTile icon={candidate.icon} />
              <span className="truncate">{candidate.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PanelNavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon className="size-4 opacity-75" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </>
  );
  return (
    <SidebarMenuItem>
      {item.disabled ? (
        <SidebarMenuButton disabled>{content}</SidebarMenuButton>
      ) : (
        <SidebarMenuButton
          isActive={item.active}
          render={<Link to={item.to} />}
        >
          {content}
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}

/**
 * The active settings area's pages, shown in the context panel under the
 * area rows (see ContextPanelSlot).
 */
export function SettingsPanelNav() {
  const { t } = useTranslation();
  const nav = useSettingsNav();

  return (
    <nav aria-label={t("settings:nav.label")} className="border-t pt-1">
      {nav.area === "project" && (
        <div className="px-3 pt-2 pb-1">
          <ProjectPicker nav={nav} className="w-full" />
        </div>
      )}
      <PanelSection label={<span className="truncate">{nav.areaLabel}</span>}>
        {nav.items.map((item) => (
          <PanelNavLink key={item.id} item={item} />
        ))}
        {nav.area === "project" && !nav.project && (
          <PanelHint>{t("settings:nav.pickProject")}</PanelHint>
        )}
      </PanelSection>
    </nav>
  );
}

function InlineNavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Button
      variant={item.active ? "secondary" : "ghost"}
      size="xs"
      disabled={item.disabled}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "shrink-0 gap-1.5 font-normal",
        item.active ? "text-foreground" : "text-muted-foreground",
      )}
      render={item.disabled ? undefined : <Link to={item.to} />}
    >
      <Icon className="size-3.5" />
      {item.label}
    </Button>
  );
}

/**
 * The same navigation as a strip under the top bar, for when the context
 * panel is closed (phones, or the panel toggled off).
 */
export function SettingsInlineNav() {
  const { t } = useTranslation();
  const nav = useSettingsNav();

  return (
    <div className="flex shrink-0 flex-col border-b bg-background">
      <nav
        aria-label={t("settings:nav.areas")}
        className="flex items-center gap-1 overflow-x-auto px-2 pt-1.5 md:px-3"
      >
        {nav.areas.map((item) => (
          <InlineNavLink key={item.id} item={item} />
        ))}
      </nav>
      <nav
        aria-label={t("settings:nav.label")}
        className="flex items-center gap-1 overflow-x-auto px-2 py-1.5 md:px-3"
      >
        {nav.area === "project" && (
          <ProjectPicker nav={nav} className="w-44 shrink-0" />
        )}
        {nav.items.map((item) => (
          <InlineNavLink key={item.id} item={item} />
        ))}
      </nav>
    </div>
  );
}
