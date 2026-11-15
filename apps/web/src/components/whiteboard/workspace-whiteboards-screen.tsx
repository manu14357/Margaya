import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  FolderKanban,
  PenTool,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@/components/common/filter-bar";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import WorkspaceLayout from "@/components/common/workspace-layout";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import PageTitle from "@/components/page-title";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { useCreateWhiteboard } from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspaceWhiteboards } from "@/hooks/queries/whiteboard/use-workspace-whiteboards";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import {
  DEFAULT_WHITEBOARD_SORT,
  isWhiteboardSort,
  sortWhiteboards,
} from "@/lib/whiteboards/sort-whiteboards";
import { summaryCapabilities } from "@/lib/whiteboards/whiteboard-capabilities";
import {
  groupWhiteboardsByProject,
  projectsWithWhiteboards,
} from "@/lib/whiteboards/workspace-whiteboards";
import type { WorkspaceWhiteboard } from "@/types/whiteboard";
import WhiteboardCard from "./whiteboard-card";
import {
  CardSkeleton,
  SortMenu,
  WHITEBOARDS_SORT_STORAGE_KEY,
} from "./whiteboards-screen";

export const WORKSPACE_WHITEBOARDS_GROUP_STORAGE_KEY =
  "margaya:workspace-whiteboards-grouped";

const ALL_PROJECTS = "all";
const GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 px-4 pb-4";

const isBoolean = (value: unknown) => typeof value === "boolean";

type Rights = Parameters<typeof summaryCapabilities>[1];

function BoardGrid({
  boards,
  rights,
  workspaceId,
  label,
}: {
  boards: readonly WorkspaceWhiteboard[];
  rights: Rights;
  workspaceId: string;
  label: string;
}) {
  return (
    <ul aria-label={label} className={GRID}>
      {boards.map((board) => (
        // min-w-0 keeps a long "Edited … by …" line truncating in its cell.
        <li key={board.id} className="flex min-w-0">
          <div className="min-w-0 flex-1">
            <WhiteboardCard
              board={board}
              capabilities={summaryCapabilities(board, rights)}
              workspaceId={workspaceId}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every whiteboard the caller can see across the workspace's projects:
 * search (titles and text on boards), sort, live or archived boards, a
 * project filter and grouping by project, and "New whiteboard" in a chosen
 * project. Cards open the board in its project.
 */
export default function WorkspaceWhiteboardsScreen({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const {
    canCreateWhiteboards,
    canUpdateWhiteboards,
    canDeleteWhiteboards,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const { data: projects, isSuccess: projectsLoaded } = useGetProjects({
    workspaceId,
  });
  const boardProjects = projectsWithWhiteboards(projects);
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim());
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [sort, setSort] = useStoredState(
    WHITEBOARDS_SORT_STORAGE_KEY,
    DEFAULT_WHITEBOARD_SORT,
    isWhiteboardSort,
  );
  const [grouped, setGrouped] = useStoredState(
    WORKSPACE_WHITEBOARDS_GROUP_STORAGE_KEY,
    true,
    isBoolean,
  );
  const boardsQuery = useWorkspaceWhiteboards(workspaceId, {
    archived,
    q: search,
  });
  const createBoard = useCreateWhiteboard();
  const untitled = t("whiteboards:list.untitled");

  const rights: Rights = {
    userId: session?.user?.id,
    canCreate: !isCheckingPermissions && canCreateWhiteboards(),
    canUpdate: !isCheckingPermissions && canUpdateWhiteboards(),
    canDelete: !isCheckingPermissions && canDeleteWhiteboards(),
  };
  const canCreate = rights.canCreate && boardProjects.length > 0;
  const filtered = projectFilter !== ALL_PROJECTS;
  const filterProject = boardProjects.find(
    (project) => project.id === projectFilter,
  );

  const boards = useMemo(() => {
    const all = boardsQuery.data?.whiteboards ?? [];
    const visible = filtered
      ? all.filter((board) => board.projectId === projectFilter)
      : all;
    return sortWhiteboards(visible, sort, untitled);
  }, [boardsQuery.data, filtered, projectFilter, sort, untitled]);

  const handleCreate = (projectId: string) => {
    if (createBoard.isPending) return;
    createBoard.mutate(
      { projectId },
      {
        onSuccess: (board) =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
            params: { workspaceId, projectId, whiteboardId: board.id },
          }),
        onError: (error) =>
          toast.error(
            pageErrorMessage(error) ?? t("whiteboards:toasts.createError"),
          ),
      },
    );
  };

  const newBoardMenu = (variant: "header" | "empty") => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          variant === "header" ? (
            <Button
              size="xs"
              className="gap-1 pointer-coarse:min-w-11"
              loading={createBoard.isPending}
            />
          ) : (
            <Button size="sm" loading={createBoard.isPending} />
          )
        }
      >
        <Plus className={variant === "header" ? "size-3" : "size-3.5"} />
        {variant === "header" ? (
          <TopBarLabel>{t("whiteboards:list.newWhiteboard")}</TopBarLabel>
        ) : (
          t("whiteboards:list.newWhiteboard")
        )}
        <ChevronDown className="size-3 opacity-72" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("whiteboards:workspace.chooseProject")}
          </DropdownMenuLabel>
          {boardProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              disabled={createBoard.isPending}
              onClick={() => handleCreate(project.id)}
            >
              <ProjectTile icon={project.icon} seed={project.id} />
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderBody = () => {
    if (boardsQuery.isLoading) {
      return (
        <div className={`${GRID} pt-4`}>
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cards
            <CardSkeleton key={index} />
          ))}
        </div>
      );
    }
    if (boardsQuery.isError) {
      return (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyTitle>{t("whiteboards:list.loadError")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void boardsQuery.refetch()}
            >
              {t("whiteboards:list.retry")}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    if (boards.length === 0) {
      const noProjects = projectsLoaded && boardProjects.length === 0;
      const copy = noProjects
        ? {
            title: t("whiteboards:workspace.empty.noProjectsTitle"),
            description: t("whiteboards:workspace.empty.noProjectsDescription"),
          }
        : search
          ? {
              title: t("whiteboards:list.empty.noMatchTitle", {
                query: search,
              }),
              description: t("whiteboards:list.empty.noMatchDescription"),
            }
          : archived
            ? {
                title: t("whiteboards:list.empty.archivedTitle"),
                description: t("whiteboards:list.empty.archivedDescription"),
              }
            : {
                title: t("whiteboards:list.empty.title"),
                description: t("whiteboards:workspace.empty.description"),
              };
      return (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PenTool />
            </EmptyMedia>
            <EmptyTitle>{copy.title}</EmptyTitle>
            <EmptyDescription>{copy.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {search ? (
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                {t("whiteboards:list.empty.clearSearch")}
              </Button>
            ) : filtered ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProjectFilter(ALL_PROJECTS)}
              >
                {t("whiteboards:workspace.showAllProjects")}
              </Button>
            ) : !archived && canCreate ? (
              newBoardMenu("empty")
            ) : null}
          </EmptyContent>
        </Empty>
      );
    }
    if (!grouped || filtered) {
      return (
        <div className="pt-4">
          <BoardGrid
            boards={boards}
            rights={rights}
            workspaceId={workspaceId}
            label={t("whiteboards:section.title")}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 pt-3">
        {groupWhiteboardsByProject(boards).map(({ project, boards: group }) => (
          <section key={project.id} aria-labelledby={`wb-group-${project.id}`}>
            <h2
              id={`wb-group-${project.id}`}
              className="flex items-center gap-2 px-4 py-2 font-medium text-[13px]"
            >
              <ProjectTile icon={project.icon} seed={project.id} />
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/whiteboards"
                params={{ workspaceId, projectId: project.id }}
                className="truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {project.name}
              </Link>
              <span className="text-muted-foreground text-xs tabular-nums">
                {group.length}
              </span>
            </h2>
            <BoardGrid
              boards={group}
              rights={rights}
              workspaceId={workspaceId}
              label={project.name}
            />
          </section>
        ))}
      </div>
    );
  };

  return (
    <>
      <PageTitle title={t("whiteboards:workspace.documentTitle")} />
      <WorkspaceLayout
        title={t("whiteboards:workspace.title")}
        headerActions={canCreate ? newBoardMenu("header") : undefined}
      >
        <div className="flex h-full min-h-0 flex-col">
          <FilterBar
            className="min-h-11 py-0 md:px-3"
            trailing={
              <>
                <div className="relative w-36 shrink-0 sm:w-60">
                  <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
                  <Input
                    type="search"
                    value={query}
                    maxLength={200}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && query) {
                        event.preventDefault();
                        setQuery("");
                      }
                    }}
                    placeholder={t("whiteboards:list.searchPlaceholder")}
                    aria-label={t("whiteboards:list.searchPlaceholder")}
                    className="h-7 pointer-coarse:h-11 [&_[data-slot=input]]:h-7 pointer-coarse:[&_[data-slot=input]]:h-11 [&_[data-slot=input]]:pr-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-[13px]"
                  />
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("whiteboards:list.searchClear")}
                      className="-translate-y-1/2 absolute top-1/2 right-1 z-10 size-5 text-muted-foreground sm:size-5"
                      onClick={() => setQuery("")}
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="xs"
                        className="gap-1 pointer-coarse:min-h-11"
                        aria-label={t("whiteboards:workspace.projectFilter")}
                      />
                    }
                  >
                    <FolderKanban className="size-3" />
                    <span className="max-w-32 truncate max-sm:sr-only">
                      {filterProject?.name ??
                        t("whiteboards:workspace.allProjects")}
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                        {t("whiteboards:workspace.projectFilter")}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={filterProject ? projectFilter : ALL_PROJECTS}
                        onValueChange={(value) =>
                          setProjectFilter(String(value))
                        }
                      >
                        <DropdownMenuRadioItem value={ALL_PROJECTS}>
                          {t("whiteboards:workspace.allProjects")}
                        </DropdownMenuRadioItem>
                        {boardProjects.map((project) => (
                          <DropdownMenuRadioItem
                            key={project.id}
                            value={project.id}
                          >
                            <span className="truncate">{project.name}</span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={grouped}
                      onCheckedChange={(checked) =>
                        setGrouped(Boolean(checked))
                      }
                    >
                      {t("whiteboards:workspace.groupByProject")}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <SortMenu sort={sort} onChange={setSort} />
              </>
            }
          >
            <Tabs
              value={archived ? "archived" : "active"}
              onValueChange={(value) => setArchived(value === "archived")}
              className="h-11 shrink-0"
            >
              <TabsList variant="underline" className="h-11 gap-0 py-0">
                <TabsTab
                  value="active"
                  className="h-11 grow-0 rounded-none px-3 font-medium text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-inset sm:h-11 sm:text-[13px]"
                >
                  {t("whiteboards:list.tabs.active")}
                </TabsTab>
                <TabsTab
                  value="archived"
                  className="h-11 grow-0 rounded-none px-3 font-medium text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-inset sm:h-11 sm:text-[13px]"
                >
                  {t("whiteboards:list.tabs.archived")}
                </TabsTab>
              </TabsList>
            </Tabs>
          </FilterBar>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            aria-busy={boardsQuery.isFetching}
          >
            {renderBody()}
          </div>
        </div>
      </WorkspaceLayout>
    </>
  );
}
