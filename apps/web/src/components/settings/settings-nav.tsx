import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Blocks,
  Bot,
  Building2,
  Code,
  CreditCard,
  FileDown,
  FolderKanban,
  GitBranch,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  MessageSquareHeart,
  NotebookPen,
  Plug,
  Ruler,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  User,
  UserRound,
  Users,
  Wand2,
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
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
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

/** A titled run of pages; the first group of an area carries its name. */
export type NavGroup = { id: string; label: string; items: NavItem[] };

const PROJECT_SEGMENTS = [
  "general",
  "features",
  "workflow",
  "estimates",
  "intake",
  "integrations",
  "visibility",
  "trash",
] as const;

// Members lives at the workspace's own URL (links and bookmarks use it), but
// it is a workspace setting and renders in the settings frame.
const MEMBERS_PATH = /^\/dashboard\/workspace\/[^/]+\/members\/?$/;

export function isWorkspaceMembersPath(pathname: string) {
  return MEMBERS_PATH.test(pathname);
}

/** The settings area a pathname belongs to. */
export function settingsAreaFromPath(pathname: string): SettingsArea {
  if (
    pathname.startsWith("/dashboard/settings/workspace") ||
    isWorkspaceMembersPath(pathname)
  )
    return "workspace";
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

/** The label each area has everywhere: area rows, tabs and the top bar. */
export function useSettingsAreaLabels(): Record<SettingsArea, string> {
  const { t } = useTranslation();
  return {
    account: t("settings:account"),
    workspace: t("navigation:page.settingsWorkspaceTab"),
    project: t("navigation:sidebar.projects"),
    instance: t("navigation:page.settingsInstanceTab"),
  };
}

/**
 * Everything the settings navigation shows for the current path: the four
 * areas, the active area's pages in groups and, for project settings, the
 * project.
 */
export function useSettingsNav() {
  const { t } = useTranslation();
  const areaLabels = useSettingsAreaLabels();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: session } = authClient.useSession();
  // Instance admins only; the API re-checks the role on every call.
  const isInstanceAdmin = session?.user?.role === "admin";
  const { data: workspace } = useActiveWorkspace();
  const { canManageWebhooks, canReadAuditLog, isCheckingPermissions, isGuest } =
    useWorkspacePermission();
  const { data: config } = useGetConfig();
  // AI settings show only once the instance has AI on, to ai:manage holders.
  const ai = useAiAvailability();
  const showAiSettings = Boolean(ai.data?.instanceEnabled && ai.canManage);
  // Skills and memory notes are for everyone who uses AI (ai:use).
  const showAiLibrary = Boolean(ai.data?.instanceEnabled && ai.canUse);
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });

  const area = settingsAreaFromPath(pathname);
  const { projectId, segment } = projectSettingsFromPath(pathname);
  const project = projects?.find((candidate) => candidate.id === projectId);

  const areas: NavItem[] = [
    {
      id: "account",
      label: areaLabels.account,
      icon: UserRound,
      to: "/dashboard/settings/account/information",
      active: area === "account",
    },
    // A guest has only their account here (see NotForGuests).
    ...(isGuest
      ? []
      : [
          {
            id: "workspace",
            label: areaLabels.workspace,
            icon: Building2,
            to: "/dashboard/settings/workspace/general",
            active: area === "workspace",
          },
          {
            id: "project",
            label: areaLabels.project,
            icon: FolderKanban,
            to: "/dashboard/settings/projects",
            active: area === "project",
            disabled: projects?.length === 0,
          },
        ]),
    ...(isInstanceAdmin
      ? [
          {
            id: "instance",
            label: areaLabels.instance,
            icon: ServerCog,
            to: "/dashboard/settings/instance/general",
            active: area === "instance",
          },
        ]
      : []),
  ];

  const exact = (to: string) => pathname === to;
  const withActive = (
    items: Omit<NavItem, "active">[],
    isActive: (item: Omit<NavItem, "active">) => boolean = (item) =>
      exact(item.to),
  ): NavItem[] => items.map((item) => ({ ...item, active: isActive(item) }));
  let groups: NavGroup[] = [];
  let areaLabel = "";

  if (area === "account") {
    areaLabel = areaLabels.account;
    groups = [
      {
        id: "account",
        label: areaLabel,
        items: withActive([
          {
            id: "information",
            label: t("settings:information"),
            icon: User,
            to: "/dashboard/settings/account/information",
          },
          {
            id: "preferences",
            label: t("settings:preferences"),
            icon: SlidersHorizontal,
            to: "/dashboard/settings/account/preferences",
          },
          {
            id: "notifications",
            label: t("settings:notifications"),
            icon: Bell,
            to: "/dashboard/settings/account/notifications",
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
          {
            id: "slack",
            label: t("settings:slackApp.accountNav"),
            icon: Plug,
            to: "/dashboard/settings/account/slack",
          },
        ]),
      },
    ];
  } else if (area === "workspace") {
    areaLabel = workspace?.name ?? areaLabels.workspace;
    const webhooksPath = "/dashboard/settings/workspace/webhooks";
    const membersPath = workspace?.id
      ? `/dashboard/workspace/${workspace.id}/members`
      : "";
    const isActive = (item: Omit<NavItem, "active">) =>
      exact(item.to) ||
      // Webhooks stays active on a webhook's detail page.
      (item.to === webhooksPath && pathname.startsWith(`${webhooksPath}/`)) ||
      (item.id === "members" && isWorkspaceMembersPath(pathname));
    groups = [
      {
        id: "workspace",
        label: areaLabel,
        items: withActive(
          [
            {
              id: "general",
              label: t("settings:workspaceGeneral.title"),
              icon: Settings,
              to: "/dashboard/settings/workspace/general",
            },
            ...(membersPath
              ? [
                  {
                    id: "members",
                    label: t("navigation:sidebar.members"),
                    icon: Users,
                    to: membersPath,
                  },
                ]
              : []),
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
                  {
                    id: "slack",
                    label: t("settings:slackApp.workspaceNav"),
                    icon: Plug,
                    to: "/dashboard/settings/workspace/slack",
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
          ],
          isActive,
        ),
      },
      {
        id: "data",
        label: t("settings:nav.groupData"),
        items: withActive([
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
        ]),
      },
      {
        id: "ai",
        label: t("ai:workspace.navLabel"),
        items: withActive([
          ...(showAiSettings
            ? [
                {
                  id: "ai",
                  label: t("settings:nav.aiSettings"),
                  icon: Sparkles,
                  to: "/dashboard/settings/workspace/ai",
                },
                {
                  id: "agents",
                  label: t("ai:agents.navLabel"),
                  icon: Bot,
                  to: "/dashboard/settings/workspace/agents",
                },
              ]
            : []),
          ...(showAiLibrary
            ? [
                {
                  id: "ai-skills",
                  label: t("ai:skills.navLabel"),
                  icon: Wand2,
                  to: "/dashboard/settings/workspace/ai-skills",
                },
                {
                  id: "ai-memory",
                  label: t("ai:memory.navLabel"),
                  icon: NotebookPen,
                  to: "/dashboard/settings/workspace/ai-memory",
                },
              ]
            : []),
        ]),
      },
    ];
  } else if (area === "project") {
    areaLabel = project?.name ?? areaLabels.project;
    const labels: Record<(typeof PROJECT_SEGMENTS)[number], string> = {
      general: t("settings:projectGeneral.title"),
      features: t("settings:projectFeatures.title"),
      visibility: t("settings:projectPublish.title"),
      integrations: t("settings:projectIntegrations.title"),
      workflow: t("settings:projectWorkflow.title"),
      estimates: t("settings:projectEstimates.title"),
      intake: t("settings:projectIntake.title"),
      trash: t("settings:trash.projectTitle"),
    };
    const icons: Record<(typeof PROJECT_SEGMENTS)[number], LucideIcon> = {
      general: Settings,
      features: Blocks,
      visibility: Globe,
      integrations: Plug,
      workflow: GitBranch,
      estimates: Ruler,
      intake: Inbox,
      trash: Trash2,
    };
    groups = [
      {
        id: "project",
        label: areaLabel,
        items: PROJECT_SEGMENTS.map((id) => ({
          id,
          label: labels[id],
          icon: icons[id],
          to: project
            ? `/dashboard/settings/projects/${project.id}/${id}`
            : "/dashboard/settings/projects",
          active: Boolean(project) && segment === id,
          disabled: !project,
        })),
      },
    ];
  } else {
    areaLabel = config?.instanceName ?? areaLabels.instance;
    const page = (
      id: keyof typeof INSTANCE_PAGE_PATHS,
      icon: LucideIcon,
      label: string,
    ) => ({ id, icon, label, to: INSTANCE_PAGE_PATHS[id] });
    groups = [
      {
        id: "instance",
        label: areaLabel,
        items: withActive([
          page("general", Settings, t("instanceAdmin:nav.general")),
          page("users", Users, t("accountSecurity:platform.users.nav")),
          page("admins", ShieldCheck, t("instanceAdmin:nav.admins")),
          page("workspaces", Building2, t("instanceAdmin:nav.workspaces")),
          page("publicBoards", Globe, t("instanceAdmin:nav.publicBoards")),
          page(
            "feedback",
            MessageSquareHeart,
            t("settings:feedback.admin.nav"),
          ),
        ]),
      },
      {
        id: "setup",
        label: t("settings:nav.groupServer"),
        items: withActive([
          page(
            "authentication",
            KeyRound,
            t("instanceAdmin:nav.authentication"),
          ),
          page("email", Mail, t("instanceAdmin:nav.email")),
          page("ai", Sparkles, t("instanceAdmin:nav.ai")),
          page("health", Activity, t("instanceAdmin:nav.health")),
        ]),
      },
    ];
  }

  groups = groups.filter((group) => group.items.length > 0);
  const items = groups.flatMap((group) => group.items);

  return {
    area,
    areas,
    areaLabel,
    groups,
    items,
    projects,
    project,
    segment,
  };
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
          {project && <ProjectTile icon={project.icon} seed={project.id} />}
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
              <ProjectTile icon={candidate.icon} seed={candidate.id} />
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
 * area rows (see ContextPanelSlot), in titled groups.
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
      {nav.groups.map((group) => (
        <PanelSection
          key={group.id}
          label={<span className="truncate">{group.label}</span>}
        >
          {group.items.map((item) => (
            <PanelNavLink key={item.id} item={item} />
          ))}
        </PanelSection>
      ))}
      {nav.area === "project" && !nav.project && (
        <PanelSection>
          <PanelHint>{t("settings:nav.pickProject")}</PanelHint>
        </PanelSection>
      )}
    </nav>
  );
}

function AreaTab({ item }: { item: NavItem }) {
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

/** The area's pages as one menu: a row of a dozen chips doesn't fit a phone. */
function PagePicker({
  nav,
  className,
}: {
  nav: SettingsNavState;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const current = nav.items.find((item) => item.active);
  const Icon = current?.icon;

  return (
    <Select
      value={current?.id ?? ""}
      onValueChange={(id) => {
        const target = nav.items.find((item) => item.id === id);
        if (target && !target.disabled) void navigate({ to: target.to });
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("settings:nav.pageLabel")}
        className={cn("font-normal", className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-4 shrink-0 opacity-75" />}
          <span className="truncate text-foreground">
            {current?.label ?? t("settings:nav.pageLabel")}
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
        {nav.groups.map((group) => (
          <SelectGroup key={group.id}>
            {nav.groups.length > 1 && (
              <SelectGroupLabel>{group.label}</SelectGroupLabel>
            )}
            {group.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  disabled={item.disabled}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ItemIcon className="size-4 shrink-0 opacity-75" />
                    <span className="truncate">{item.label}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The same navigation under the top bar, for when the context panel is
 * closed (phones, or the panel toggled off): the areas as tabs, then the
 * project (for project settings) and the page as menus.
 */
export function SettingsInlineNav() {
  const { t } = useTranslation();
  const nav = useSettingsNav();

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b bg-background px-2 py-1.5 md:px-3">
      <nav
        aria-label={t("settings:nav.areas")}
        className="flex items-center gap-1 overflow-x-auto"
      >
        {nav.areas.map((item) => (
          <AreaTab key={item.id} item={item} />
        ))}
      </nav>
      <nav
        aria-label={t("settings:nav.label")}
        className="flex min-w-0 items-center gap-2"
      >
        {nav.area === "project" && (
          <ProjectPicker nav={nav} className="w-auto min-w-0 flex-1" />
        )}
        <PagePicker nav={nav} className="w-auto min-w-0 flex-1" />
      </nav>
    </div>
  );
}
