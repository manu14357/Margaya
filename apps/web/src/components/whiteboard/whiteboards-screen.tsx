import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  PenTool,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@/components/common/filter-bar";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import { useStoredState } from "@/components/planning/use-stored-state";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Group, GroupSeparator } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { useCreateWhiteboard } from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWhiteboards } from "@/hooks/queries/whiteboard/use-whiteboards";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import {
  DEFAULT_WHITEBOARD_SORT,
  isWhiteboardSort,
  sortWhiteboards,
  WHITEBOARD_SORT_FIELDS,
} from "@/lib/whiteboards/sort-whiteboards";
import { summaryCapabilities } from "@/lib/whiteboards/whiteboard-capabilities";
import {
  buildTemplateElements,
  WHITEBOARD_TEMPLATES,
  type WhiteboardTemplateId,
} from "@/lib/whiteboards/whiteboard-templates";
import type { WhiteboardSort, WhiteboardSortField } from "@/types/whiteboard";
import WhiteboardCard from "./whiteboard-card";

export const WHITEBOARDS_SORT_STORAGE_KEY = "margaya:whiteboards-sort";

export const SORT_KEYS: Record<WhiteboardSortField, string> = {
  updatedAt: "whiteboards:list.sort.lastEdited",
  createdAt: "whiteboards:list.sort.created",
  title: "whiteboards:list.sort.name",
};

type WhiteboardsScreenProps = {
  workspaceId: string;
  projectId: string;
};

export function CardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border/80"
    >
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="space-y-2 px-3 py-2.5">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

export function SortMenu({
  sort,
  onChange,
}: {
  sort: WhiteboardSort;
  onChange: (sort: WhiteboardSort) => void;
}) {
  const { t } = useTranslation();
  const DirectionIcon = sort.direction === "asc" ? ArrowUpAZ : ArrowDownAZ;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="gap-1 pointer-coarse:h-11 pointer-coarse:min-w-11"
          />
        }
      >
        <DirectionIcon className="size-3" />
        <span className="sr-only sm:not-sr-only">
          {t(SORT_KEYS[sort.field])}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:sort.by")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.field}
            onValueChange={(field) =>
              onChange({ ...sort, field: field as WhiteboardSortField })
            }
          >
            {WHITEBOARD_SORT_FIELDS.map((field) => (
              <DropdownMenuRadioItem key={field} value={field}>
                {t(SORT_KEYS[field])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:sort.direction")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort.direction}
            onValueChange={(direction) =>
              onChange({
                ...sort,
                direction: direction as WhiteboardSort["direction"],
              })
            }
          >
            <DropdownMenuRadioItem value="asc">
              {t("tasks:sort.ascending")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="desc">
              {t("tasks:sort.descending")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The project's Whiteboards section: a grid of board cards with search
 * (titles and text on boards), sort and the archived boards, and "New
 * whiteboard", blank or from a template.
 */
export default function WhiteboardsScreen({
  workspaceId,
  projectId,
}: WhiteboardsScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const {
    canCreateWhiteboards,
    canUpdateWhiteboards,
    canDeleteWhiteboards,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreateWhiteboards();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim());
  const [sort, setSort] = useStoredState(
    WHITEBOARDS_SORT_STORAGE_KEY,
    DEFAULT_WHITEBOARD_SORT,
    isWhiteboardSort,
  );
  const boardsQuery = useWhiteboards(projectId, { archived, q: search });
  const createBoard = useCreateWhiteboard();
  const untitled = t("whiteboards:list.untitled");

  const rights = {
    userId,
    canCreate: !isCheckingPermissions && canCreateWhiteboards(),
    canUpdate: !isCheckingPermissions && canUpdateWhiteboards(),
    canDelete: !isCheckingPermissions && canDeleteWhiteboards(),
  };

  const boards = useMemo(
    () => sortWhiteboards(boardsQuery.data?.whiteboards ?? [], sort, untitled),
    [boardsQuery.data, sort, untitled],
  );

  const handleCreate = (templateId: WhiteboardTemplateId = "blank") => {
    if (createBoard.isPending) return;
    const elements = buildTemplateElements(templateId, t);
    const template = WHITEBOARD_TEMPLATES.find(
      (entry) => entry.id === templateId,
    );
    createBoard.mutate(
      {
        projectId,
        ...(templateId !== "blank" && template
          ? { title: t(template.nameKey) }
          : {}),
        ...(elements.length > 0 ? { elements } : {}),
      },
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

  const renderBody = () => {
    if (boardsQuery.isLoading) {
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 p-4">
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
      const copy = search
        ? {
            title: t("whiteboards:list.empty.noMatchTitle", { query: search }),
            description: t("whiteboards:list.empty.noMatchDescription"),
          }
        : archived
          ? {
              title: t("whiteboards:list.empty.archivedTitle"),
              description: t("whiteboards:list.empty.archivedDescription"),
            }
          : {
              title: t("whiteboards:list.empty.title"),
              description: t("whiteboards:list.empty.description"),
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
            ) : !archived && canCreate ? (
              <Button
                size="sm"
                loading={createBoard.isPending}
                onClick={() => handleCreate()}
              >
                <Plus className="size-3.5" />
                {t("whiteboards:list.newWhiteboard")}
              </Button>
            ) : null}
          </EmptyContent>
        </Empty>
      );
    }
    return (
      <ul
        aria-label={t("whiteboards:section.title")}
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 p-4"
      >
        {boards.map((board) => (
          // min-w-0 keeps a long "Edited … by …" line truncating inside the
          // grid cell instead of widening the card over its neighbour.
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
  };

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="whiteboards"
      headerActions={
        canCreate ? (
          <Group aria-label={t("whiteboards:list.newWhiteboard")}>
            <Button
              size="xs"
              className="gap-1 pointer-coarse:min-w-11"
              loading={createBoard.isPending}
              onClick={() => handleCreate()}
            >
              <Plus className="size-3" />
              <TopBarLabel>{t("whiteboards:list.newWhiteboard")}</TopBarLabel>
            </Button>
            <GroupSeparator />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    aria-label={t("whiteboards:list.moreCreateOptions")}
                    className="pointer-coarse:min-w-11"
                  />
                }
              >
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                    {t("whiteboards:templates.title")}
                  </DropdownMenuLabel>
                  {WHITEBOARD_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    return (
                      <DropdownMenuItem
                        key={template.id}
                        disabled={createBoard.isPending}
                        onClick={() => handleCreate(template.id)}
                        className="items-start"
                      >
                        <Icon className="mt-0.5" />
                        <span className="flex min-w-0 flex-col">
                          <span>{t(template.nameKey)}</span>
                          <span className="text-muted-foreground text-xs">
                            {t(template.descriptionKey)}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Group>
        ) : null
      }
    >
      <PageTitle
        title={t("whiteboards:list.documentTitle", {
          project: project?.name ?? "",
        })}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="whiteboards"
      >
        <div className="flex h-full min-h-0 flex-col">
          <FilterBar
            className="min-h-11 py-0 md:px-3"
            trailing={
              <>
                {archived && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    render={
                      <Link
                        to="/dashboard/settings/projects/$projectId/trash"
                        params={{ projectId }}
                      />
                    }
                  >
                    <Trash2 className="size-3.5" />
                    <span className="max-sm:sr-only">
                      {t("whiteboards:list.recentlyDeleted")}
                    </span>
                  </Button>
                )}
                <div className="relative w-40 shrink-0 sm:w-60">
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
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
