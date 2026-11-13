import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Boxes,
  CornerDownLeftIcon,
  FolderKanban,
  Inbox,
  IterationCw,
  Layers,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CreateIntakeDialog from "@/components/intake/lazy-create-intake-dialog";
import SearchCommandMenu from "@/components/search-command-menu";
import CreateWorkspaceModal from "@/components/shared/modals/create-workspace-modal";
import CreateTaskModal from "@/components/shared/modals/lazy-create-task-modal";
import useOpenTaskStore from "@/components/task/task-shortcuts/open-task-store";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { shortcuts } from "@/constants/shortcuts";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetRecentVisits from "@/hooks/queries/recent-visit/use-get-recent-visits";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { getEntityIcon, getEntityPath } from "@/lib/entity-links";
import {
  type PlanningResultType,
  planningResultPath,
} from "@/lib/search-result-path";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { useAskCommands } from "../ai/ask/use-ask-commands";
import { useBuildWithAiCommand } from "../ai-build/use-build-with-ai-command";
import { useFeedbackCommand } from "../feedback/use-feedback-command";
import { usePageCommands } from "../page/use-page-commands";
import CreateProjectModal from "../shared/modals/create-project-modal";
import { EntityCommandsSource } from "./entity-commands";
import {
  isPalettePrefix,
  matchesTerm,
  type PaletteMode,
  parsePaletteQuery,
} from "./palette-query";
import usePaletteRequests from "./palette-store";
import type {
  PaletteActionItem,
  PaletteGroup,
  PaletteSubmenu,
} from "./palette-types";
import { openTaskGroupItems } from "./task-group";
import { usePreferenceCommands } from "./use-preference-commands";
import { useViewCommands } from "./use-view-commands";

type SearchResult = {
  id: string;
  title: string;
  type:
    | "task"
    | "project"
    | "workspace"
    | "comment"
    | "activity"
    | "page"
    | PlanningResultType;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  taskNumber?: number;
  status?: string;
};

const PLANNING_RESULT_ICONS: Record<PlanningResultType, LucideIcon> = {
  cycle: IterationCw,
  module: Boxes,
  view: Layers,
  intake: Inbox,
};

// Plain-text search starts at this many characters, as typing settles.
const SEARCH_MIN_CHARS = 2;

// Item values in Suggestions that are places to go; the rest are actions.
const PLACE_VALUES = new Set([
  "home",
  "projects",
  "stickies",
  "inbox",
  "drafts",
  "archives",
  "project-archives",
  "members",
  "analytics",
  "project-analytics",
  "my-work",
  "all-tasks",
  "settings",
]);

function CommandPalette() {
  const { t } = useTranslation();
  const { setTheme } = useUserPreferencesStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: session } = authClient.useSession();
  const { data: config } = useGetConfig();
  const isAdmin = session?.user?.role === "admin";
  const canCreateWorkspace =
    isAdmin || (config !== undefined && !config.disableWorkspaceCreation);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;
  // A sub-list (languages, time zones, a module's statuses) shown in place
  // of the root; Backspace in an empty field goes back.
  const [submenu, setSubmenu] = useState<PaletteSubmenu | null>(null);
  const submenuRef = useRef(submenu);
  submenuRef.current = submenu;
  // The open page's, cycle's or module's commands (EntityCommandsSource).
  const [entityGroup, setEntityGroup] = useState<PaletteGroup | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
  const projectIdFromRoute =
    location.pathname.match(/\/project\/([^/]+)/)?.[1] ?? undefined;
  const isBacklogView = location.pathname.endsWith("/backlog");
  // Searches start scoped to the project the palette opened in; the chip
  // removes the scope.
  const [scopeProjectId, setScopeProjectId] = useState<string | undefined>();
  // "New request" inside a project whose intake is on.
  const [isCreateRequestOpen, setIsCreateRequestOpen] = useState(false);
  const { isEnabled: isProjectFeatureOn } = useProjectFeatures({
    projectId: projectIdFromRoute ?? "",
    workspaceId: workspaceId ?? "",
  });
  const { canCreateIntake, canReadAnalytics, isCheckingPermissions } =
    useWorkspacePermission();
  const canNewRequest =
    Boolean(projectIdFromRoute) &&
    !isCheckingPermissions &&
    canCreateIntake() &&
    isProjectFeatureOn("intake");
  const canOpenAnalytics = !isCheckingPermissions && canReadAnalytics();

  const openWith = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      setScopeProjectId(projectIdFromRoute);
      setOpen(true);
    },
    [projectIdFromRoute],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setSubmenu(null);
    }
  }, []);
  const openSubmenu = useCallback((next: PaletteSubmenu) => {
    setSubmenu(next);
    setQuery("");
  }, []);

  // Requests from the shell (top-bar field, rail Create menu, mobile tabs).
  // Ids seen before this palette mounted are ignored.
  const openRequest = usePaletteRequests((state) => state.openRequest);
  const createRequest = usePaletteRequests((state) => state.createRequest);
  const handledRequest = useRef({
    open: usePaletteRequests.getState().openRequest?.id,
    create: usePaletteRequests.getState().createRequest?.id,
  });
  useEffect(() => {
    if (!openRequest || openRequest.id === handledRequest.current.open) return;
    handledRequest.current.open = openRequest.id;
    openWith(openRequest.query);
  }, [openRequest, openWith]);
  useEffect(() => {
    if (!createRequest || createRequest.id === handledRequest.current.create)
      return;
    handledRequest.current.create = createRequest.id;
    if (createRequest.kind === "task") setIsCreateTaskOpen(true);
    if (createRequest.kind === "project") setIsCreateProjectOpen(true);
    if (createRequest.kind === "workspace" && canCreateWorkspace) {
      setIsCreateWorkspaceOpen(true);
    }
  }, [createRequest, canCreateWorkspace]);

  useRegisterShortcuts({
    shortcuts: {
      [shortcuts.help.key]: () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
      },
    },
    modifierShortcuts: {
      [shortcuts.palette.prefix]: {
        [shortcuts.palette.open]: () => {
          if (open) {
            handleOpenChange(false);
          } else {
            openWith("");
          }
        },
      },
    },
    sequentialShortcuts: {
      [shortcuts.project.prefix]: {
        [shortcuts.project.list]: () => {
          if (!workspaceId) return;
          navigate({
            to: "/dashboard/workspace/$workspaceId/projects",
            params: { workspaceId },
          });
        },
        [shortcuts.project.create]: () => setIsCreateProjectOpen(true),
      },
      [shortcuts.task.prefix]: {
        [shortcuts.task.create]: () => setIsCreateTaskOpen(true),
      },
      [shortcuts.workspace.prefix]: {
        [shortcuts.workspace.create]: () => {
          if (!canCreateWorkspace) return;
          setIsCreateWorkspaceOpen(true);
        },
      },
    },
  });

  // A command that opens a picker waits for the palette to unmount, and the
  // palette then skips its focus return: either would close the picker.
  const afterClose = useRef<(() => void) | null>(null);
  const [skipFocusReturn, setSkipFocusReturn] = useState(false);
  const runCommand = useCallback(
    (command: () => void, deferred = false) => {
      if (deferred) {
        afterClose.current = command;
        setSkipFocusReturn(true);
      } else {
        command();
      }
      handleOpenChange(false);
    },
    [handleOpenChange],
  );
  const handleOpenChangeComplete = useCallback((isOpen: boolean) => {
    const command = afterClose.current;
    afterClose.current = null;
    setSkipFocusReturn(false);
    // The unmount commits after this callback; run once it has.
    if (!isOpen && command) window.setTimeout(command, 0);
  }, []);
  const viewCommands = useViewCommands({
    workspaceId,
    projectId: projectIdFromRoute,
    open,
  });
  const buildWithAi = useBuildWithAiCommand(projectIdFromRoute);
  const pageCommands = usePageCommands({
    workspaceId,
    projectId: projectIdFromRoute,
  });
  const preferenceCommands = usePreferenceCommands({ open });
  const feedbackCommand = useFeedbackCommand();

  const { mode, term } = parsePaletteQuery(query);
  const askCommands = useAskCommands({
    projectId: projectIdFromRoute,
    term: open && mode === "all" ? term : "",
  });

  // Data for the prefixed modes loads only while it can show.
  const { data: projects } = useGetProjects({
    workspaceId: open ? (workspaceId ?? "") : "",
  });
  const { data: recentVisits } = useGetRecentVisits({
    workspaceId: open && mode === "all" && !term ? (workspaceId ?? "") : "",
    limit: 5,
  });
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    open && mode === "people" ? (workspaceId ?? "") : "",
  );
  const searchTerm =
    open &&
    ((mode === "tasks" && term.length > 0) ||
      (mode === "all" && term.length >= SEARCH_MIN_CHARS))
      ? term
      : "";
  const { data: searchData } = useGlobalSearch({
    q: searchTerm,
    type: mode === "tasks" ? "tasks" : "all",
    workspaceId,
    projectId: scopeProjectId,
    limit: 12,
  });
  const scopeProject = projects?.find(
    (project) => project.id === scopeProjectId,
  );

  // With a task open (sheet or page), its commands come first. Pickers
  // open once the palette has closed (see runCommand).
  const openTaskCommands = useOpenTaskStore((state) => state.commands);
  const taskGroup = useMemo<PaletteGroup | null>(() => {
    if (!open) return null;
    const items = openTaskGroupItems(openTaskCommands);
    return items.length > 0
      ? {
          value: "this-task",
          label: t("tasks:commands.group"),
          items,
        }
      : null;
  }, [open, openTaskCommands, t]);

  const groupedItems = useMemo<PaletteGroup[]>(
    () => [
      {
        value: "suggestions",
        label: t("navigation:commandPalette.suggestions"),
        items: [
          {
            value: "home",
            label: t("navigation:commandPalette.home"),
            shortcut: `${shortcuts.workspaceGo.prefix} ${shortcuts.workspaceGo.home}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId",
                params: { workspaceId },
              });
            },
          },
          {
            value: "projects",
            label: t("navigation:commandPalette.projects"),
            shortcut: `${shortcuts.project.prefix} ${shortcuts.project.list}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/projects",
                params: { workspaceId },
              });
            },
          },
          {
            value: "stickies",
            label: t("navigation:commandPalette.stickies"),
            shortcut: `${shortcuts.workspaceGo.prefix} ${shortcuts.workspaceGo.stickies}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/stickies",
                params: { workspaceId },
              });
            },
          },
          {
            value: "inbox",
            label: t("navigation:commandPalette.goToInbox"),
            shortcut: `${shortcuts.notification.prefix} ${shortcuts.notification.inbox}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/inbox",
                params: { workspaceId },
              });
            },
          },
          {
            value: "my-work",
            label: t("navigation:sidebar.myWork"),
            shortcut: `${shortcuts.workspaceGo.prefix} ${shortcuts.workspaceGo.myWork}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/my-work",
                params: { workspaceId },
              });
            },
          },
          {
            value: "all-tasks",
            label: t("navigation:sidebar.allTasks"),
            shortcut: `${shortcuts.workspaceGo.prefix} ${shortcuts.workspaceGo.allTasks}`,
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/views/$viewId",
                params: { workspaceId, viewId: "all" },
              });
            },
          },
          {
            value: "drafts",
            label: t("navigation:commandPalette.goToDrafts"),
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/drafts",
                params: { workspaceId },
              });
            },
          },
          {
            value: "archives",
            label: t("navigation:commandPalette.goToArchives"),
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/archives",
                params: { workspaceId },
              });
            },
          },
          ...(projectIdFromRoute
            ? [
                {
                  value: "project-archives",
                  label: t("navigation:commandPalette.goToProjectArchives"),
                  onRun: () => {
                    if (!workspaceId) return;
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/project/$projectId/archives",
                      params: {
                        workspaceId,
                        projectId: projectIdFromRoute,
                      },
                    });
                  },
                },
              ]
            : []),
          {
            value: "search",
            label: t("navigation:commandPalette.search"),
            shortcut: shortcuts.search.prefix,
            onRun: () => setIsSearchOpen(true),
          },
          ...askCommands.items,
          {
            value: "members",
            label: t("navigation:commandPalette.members", {
              defaultValue: "Members",
            }),
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/members",
                params: { workspaceId },
              });
            },
          },
          ...(canOpenAnalytics
            ? [
                {
                  value: "analytics",
                  label: t("navigation:commandPalette.goToAnalytics"),
                  onRun: () => {
                    if (!workspaceId) return;
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/analytics",
                      params: { workspaceId },
                    });
                  },
                },
              ]
            : []),
          ...(canOpenAnalytics && projectIdFromRoute
            ? [
                {
                  value: "project-analytics",
                  label: t("navigation:commandPalette.projectAnalytics"),
                  onRun: () => {
                    if (!workspaceId) return;
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/project/$projectId/analytics",
                      params: {
                        workspaceId,
                        projectId: projectIdFromRoute,
                      },
                    });
                  },
                },
              ]
            : []),
          {
            value: "settings",
            label: t("navigation:shell.settings"),
            onRun: () =>
              navigate({ to: "/dashboard/settings/account/information" }),
          },
          {
            value: "create-task",
            label: t("navigation:commandPalette.createTask"),
            shortcut: `${shortcuts.task.prefix} ${shortcuts.task.create}`,
            onRun: () => setIsCreateTaskOpen(true),
          },
          ...(canNewRequest
            ? [
                {
                  value: "new-request",
                  label: t("intake:commandPalette.newRequest"),
                  onRun: () => setIsCreateRequestOpen(true),
                },
              ]
            : []),
          ...pageCommands,
          {
            value: "create-project",
            label: t("navigation:commandPalette.createProject"),
            shortcut: `${shortcuts.project.prefix} ${shortcuts.project.create}`,
            onRun: () => setIsCreateProjectOpen(true),
          },
          ...buildWithAi.items,
        ],
      },
      {
        value: "commands",
        label: t("navigation:commandPalette.commands"),
        items: [
          ...(canCreateWorkspace
            ? [
                {
                  value: "create-workspace",
                  label: t("navigation:commandPalette.createWorkspace"),
                  shortcut: `${shortcuts.workspace.prefix} ${shortcuts.workspace.create}`,
                  onRun: () => setIsCreateWorkspaceOpen(true),
                },
              ]
            : []),
          {
            value: "new-sticky",
            label: t("navigation:commandPalette.newSticky"),
            onRun: () => {
              if (!workspaceId) return;
              navigate({
                to: "/dashboard/workspace/$workspaceId/stickies",
                params: { workspaceId },
                search: { new: true },
              });
            },
          },
          {
            value: "theme-light",
            label: t("navigation:commandPalette.lightTheme"),
            onRun: () => setTheme("light"),
          },
          {
            value: "theme-dark",
            label: t("navigation:commandPalette.darkTheme"),
            onRun: () => setTheme("dark"),
          },
          {
            value: "theme-system",
            label: t("navigation:commandPalette.systemTheme"),
            onRun: () => setTheme("system"),
          },
          {
            value: "theme-light-contrast",
            label: t("navigation:commandPalette.lightContrastTheme"),
            onRun: () => setTheme("light-contrast"),
          },
          {
            value: "theme-dark-contrast",
            label: t("navigation:commandPalette.darkContrastTheme"),
            onRun: () => setTheme("dark-contrast"),
          },
          ...preferenceCommands,
          {
            value: "keyboard-shortcuts",
            label: t("navigation:commandPalette.keyboardShortcuts"),
            shortcut: "?",
            onRun: () => {
              setTimeout(() => {
                document.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "?" }),
                );
              }, 100);
            },
          },
          ...feedbackCommand,
        ],
      },
      ...(viewCommands.items.length > 0
        ? [
            {
              value: "views",
              label: viewCommands.label,
              items: viewCommands.items,
            },
          ]
        : []),
    ],
    [
      navigate,
      setTheme,
      t,
      workspaceId,
      canCreateWorkspace,
      canNewRequest,
      canOpenAnalytics,
      projectIdFromRoute,
      viewCommands.items,
      viewCommands.label,
      buildWithAi.items,
      pageCommands,
      preferenceCommands,
      askCommands.items,
      feedbackCommand,
    ],
  );

  const projectItems = useMemo<PaletteActionItem[]>(
    () =>
      (projects ?? []).map((project) => ({
        value: `project:${project.id}`,
        label: project.name,
        hint: project.slug ?? undefined,
        icon: <FolderKanban aria-hidden className="size-4 opacity-72" />,
        onRun: () => {
          if (!workspaceId) return;
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params: { workspaceId, projectId: project.id },
          });
        },
      })),
    [projects, navigate, workspaceId],
  );

  const resultItems = useMemo<PaletteActionItem[]>(() => {
    const results = (searchData?.results ?? []) as SearchResult[];
    return results.flatMap((result) => {
      if (!workspaceId) return [];
      // Cycles, modules, views and intake requests: plain-text search only.
      const planningPath =
        mode === "all" ? planningResultPath(result, workspaceId) : null;
      if (planningPath) {
        const Icon = PLANNING_RESULT_ICONS[result.type as PlanningResultType];
        const key =
          result.type === "intake" &&
          result.projectSlug &&
          result.taskNumber != null
            ? `${result.projectSlug}-${result.taskNumber}`
            : undefined;
        return [
          {
            value: `${result.type}:${result.id}`,
            label: result.title,
            hint: key ?? result.projectName,
            icon: Icon ? (
              <Icon aria-hidden className="size-4 opacity-72" />
            ) : undefined,
            onRun: () => navigate({ href: planningPath }),
          },
        ];
      }
      if (!result.projectId) return [];
      const projectId = result.projectId;
      if (result.type === "task") {
        const key =
          result.projectSlug && result.taskNumber != null
            ? `${result.projectSlug}-${result.taskNumber}`
            : undefined;
        return [
          {
            value: `task:${result.id}`,
            label: result.title,
            hint: key,
            onRun: () =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                params: { workspaceId, projectId, taskId: result.id },
              }),
          },
        ];
      }
      if (result.type === "page" && mode === "all") {
        return [
          {
            value: `page:${result.id}`,
            label: result.title,
            hint: result.projectName,
            onRun: () =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                params: { workspaceId, projectId, pageId: result.id },
              }),
          },
        ];
      }
      return [];
    });
  }, [searchData?.results, workspaceId, navigate, mode]);

  const visibleGroups = useMemo<PaletteGroup[]>(() => {
    const filterItems = (items: PaletteActionItem[]) =>
      items.filter((item) => matchesTerm(term, item.label, item.hint));
    const withItems = (groups: PaletteGroup[]) =>
      groups.filter((group) => group.items.length > 0);
    if (submenu) {
      // Prefix characters mean nothing here: the whole field filters.
      const needle = query.trim();
      return withItems([
        {
          value: "submenu",
          label: submenu.label,
          items: submenu.items
            .filter((item) => matchesTerm(needle, item.label, item.hint))
            .slice(0, 60),
        },
      ]);
    }
    const contextGroups = [taskGroup, entityGroup].filter(
      (group): group is PaletteGroup => group !== null,
    );
    const allItems = groupedItems.flatMap((group) =>
      group.value === "views" ? [] : group.items,
    );
    const viewItems =
      groupedItems.find((group) => group.value === "views")?.items ?? [];

    switch (mode as PaletteMode) {
      case "actions":
        return withItems([
          ...contextGroups.map((group) => ({
            ...group,
            items: filterItems(group.items),
          })),
          {
            value: "actions",
            label: t("navigation:commandPalette.prefixes.actions"),
            items: filterItems(
              allItems.filter((item) => !PLACE_VALUES.has(item.value)),
            ),
          },
        ]);
      case "places":
        return withItems([
          {
            value: "places",
            label: t("navigation:commandPalette.jumpTo"),
            items: filterItems([
              ...allItems.filter((item) => PLACE_VALUES.has(item.value)),
              ...viewItems,
            ]),
          },
          {
            value: "projects",
            label: t("navigation:commandPalette.projects"),
            items: filterItems(projectItems).slice(0, 12),
          },
        ]);
      case "tasks":
        return withItems([
          {
            value: "tasks",
            label: t("navigation:search.groups.task"),
            items: resultItems,
          },
        ]);
      case "people":
        return withItems([
          {
            value: "people",
            label: t("navigation:commandPalette.prefixes.people"),
            items: (workspaceUsers?.members ?? [])
              .filter((member) =>
                matchesTerm(term, member.user?.name, member.user?.email),
              )
              .slice(0, 12)
              .map((member) => ({
                value: `person:${member.id}`,
                label: member.user?.name || member.user?.email || "",
                hint: member.user?.email,
                onRun: () => {
                  if (!workspaceId) return;
                  navigate({
                    to: "/dashboard/workspace/$workspaceId/members",
                    params: { workspaceId },
                  });
                },
              })),
          },
        ]);
      default: {
        if (!term) {
          const recentItems = (recentVisits ?? []).flatMap((visit) => {
            const path = workspaceId
              ? getEntityPath(visit.entity, workspaceId)
              : null;
            if (!path) return [];
            const Icon = getEntityIcon(visit.entity);
            return [
              {
                value: `recent:${visit.entity.type}:${visit.entity.id}`,
                label: visit.entity.name,
                hint: visit.entity.projectName ?? undefined,
                icon: <Icon aria-hidden className="size-4 opacity-72" />,
                onRun: () => navigate({ to: path }),
              },
            ];
          });
          return withItems([
            ...contextGroups,
            {
              value: "recent",
              label: t("navigation:commandPalette.recent"),
              items: recentItems,
            },
            ...groupedItems,
          ]);
        }
        return withItems([
          ...contextGroups.map((group) => ({
            ...group,
            items: filterItems(group.items),
          })),
          ...groupedItems.map((group) => ({
            ...group,
            items: filterItems(group.items),
          })),
          {
            value: "projects-found",
            label: t("navigation:commandPalette.projects"),
            items: filterItems(projectItems).slice(0, 6),
          },
          {
            value: "results",
            label: t("navigation:search.groups.fallback"),
            items: resultItems,
          },
          {
            value: "ask",
            label: t("ai:ask.title"),
            items: askCommands.askItems,
          },
        ]);
      }
    }
  }, [
    askCommands.askItems,
    mode,
    term,
    t,
    groupedItems,
    projectItems,
    resultItems,
    workspaceUsers,
    recentVisits,
    workspaceId,
    navigate,
    taskGroup,
    entityGroup,
    submenu,
    query,
  ]);

  const shortcutHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const group of groupedItems) {
      for (const item of group.items) {
        if (!item.shortcut) continue;
        handlers.set(
          item.shortcut.replace(/\s+/g, "").toLowerCase(),
          item.onRun,
        );
      }
    }
    return handlers;
  }, [groupedItems]);

  // An item's shortcut, typed into an otherwise empty field, runs it
  // ("gh" goes Home). Prefix characters and longer text are a search.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (submenuRef.current) {
        if (event.key === "Backspace" && queryRef.current === "") {
          event.preventDefault();
          setSubmenu(null);
        }
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key === "Shift"
      ) {
        return;
      }

      if (event.key.length !== 1) return;

      const current = queryRef.current;
      if (current.length > 0 && isPalettePrefix(current.trimStart()[0] ?? "")) {
        return;
      }
      if (isPalettePrefix(event.key) && current.length === 0) return;

      const typed = `${current}${event.key}`.replace(/\s+/g, "").toLowerCase();
      const handler = shortcutHandlers.get(typed);
      if (!handler) return;

      event.preventDefault();
      runCommand(handler);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, shortcutHandlers, runCommand]);

  const placeholder = submenu
    ? submenu.label
    : mode === "actions"
      ? t("navigation:commandPalette.placeholders.actions")
      : mode === "tasks"
        ? t("navigation:commandPalette.placeholders.tasks")
        : mode === "people"
          ? t("navigation:commandPalette.placeholders.people")
          : mode === "places"
            ? t("navigation:commandPalette.placeholders.places")
            : t("navigation:commandPalette.inputPlaceholder");

  const emptyText =
    mode === "tasks" && !term
      ? t("navigation:commandPalette.placeholders.tasks")
      : t("navigation:commandPalette.empty");

  const showScopeChip =
    Boolean(scopeProject) && (mode === "tasks" || (mode === "all" && term));

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <CommandDialogPopup
          instant
          finalFocus={skipFocusReturn ? false : undefined}
        >
          <Command
            items={visibleGroups}
            filter={null}
            value={query}
            onValueChange={(value, details) => {
              // Picking an item runs it; it must not refill the field.
              if (details.reason !== "item-press") setQuery(value);
            }}
          >
            <CommandInput placeholder={placeholder} />
            {showScopeChip && scopeProject && (
              <div className="flex items-center gap-1.5 px-4 pb-2 text-muted-foreground text-xs">
                <span>{t("navigation:commandPalette.scope")}</span>
                <span className="inline-flex h-5 items-center gap-1 rounded-full border bg-background ps-2 pe-0.5 text-foreground">
                  {scopeProject.name}
                  <button
                    type="button"
                    aria-label={t("navigation:commandPalette.removeScope")}
                    className="inline-flex size-4 items-center justify-center rounded-full hover:bg-accent"
                    onClick={() => setScopeProjectId(undefined)}
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </span>
              </div>
            )}
            <CommandPanel>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandList>
                {(group: PaletteGroup, groupIndex: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.label}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: PaletteActionItem) => {
                          return (
                            <CommandItem
                              key={item.value}
                              value={item.value}
                              onClick={() =>
                                item.submenu
                                  ? openSubmenu(item.submenu())
                                  : runCommand(item.onRun, item.afterClose)
                              }
                              className="gap-2 px-3"
                            >
                              {item.icon}
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                              {item.hint && (
                                <span className="shrink-0 font-mono text-muted-foreground text-xs">
                                  {item.hint}
                                </span>
                              )}
                              {item.shortcut && (
                                <CommandShortcut>
                                  {item.shortcut}
                                </CommandShortcut>
                              )}
                            </CommandItem>
                          );
                        }}
                      </CommandCollection>
                    </CommandGroup>
                    {groupIndex < visibleGroups.length - 1 && (
                      <CommandSeparator />
                    )}
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <KbdGroup>
                    <Kbd>
                      <ArrowUpIcon />
                    </Kbd>
                    <Kbd>
                      <ArrowDownIcon />
                    </Kbd>
                  </KbdGroup>
                  <span>{t("navigation:commandPalette.footer.navigate")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>
                    <CornerDownLeftIcon />
                  </Kbd>
                  <span>{t("navigation:commandPalette.footer.open")}</span>
                </div>
              </div>
              <div className="hidden items-center gap-3 sm:flex">
                <PrefixHint
                  prefix=">"
                  label={t("navigation:commandPalette.prefixes.actions")}
                />
                <PrefixHint
                  prefix="#"
                  label={t("navigation:commandPalette.prefixes.tasks")}
                />
                <PrefixHint
                  prefix="@"
                  label={t("navigation:commandPalette.prefixes.people")}
                />
                <PrefixHint
                  prefix="/"
                  label={t("navigation:commandPalette.prefixes.places")}
                />
              </div>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>

      <EntityCommandsSource
        pathname={location.pathname}
        workspaceId={workspaceId}
        onGroup={setEntityGroup}
      />
      <SearchCommandMenu open={isSearchOpen} setOpen={setIsSearchOpen} />
      <CreateTaskModal
        open={isCreateTaskOpen}
        projectId={projectIdFromRoute}
        status={isBacklogView ? "planned" : undefined}
        onClose={() => setIsCreateTaskOpen(false)}
      />
      {canNewRequest && projectIdFromRoute && (
        <CreateIntakeDialog
          open={isCreateRequestOpen}
          onOpenChange={setIsCreateRequestOpen}
          projectId={projectIdFromRoute}
        />
      )}
      <CreateWorkspaceModal
        open={isCreateWorkspaceOpen}
        onClose={() => setIsCreateWorkspaceOpen(false)}
      />
      <CreateProjectModal
        open={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
      />
      {viewCommands.dialog}
      {buildWithAi.dialog}
    </>
  );
}

function PrefixHint({ prefix, label }: { prefix: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Kbd className="font-mono">{prefix}</Kbd>
      <span>{label}</span>
    </span>
  );
}

export default CommandPalette;
