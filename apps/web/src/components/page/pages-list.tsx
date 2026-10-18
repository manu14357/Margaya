import { Search, Star, X } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar } from "@/components/common/filter-bar";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import useGetFavorites from "@/hooks/queries/favorite/use-get-favorites";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import { cn } from "@/lib/cn";
import { indexPages, pageAncestors } from "@/lib/pages/build-page-tree";
import {
  countPagesByTab,
  DEFAULT_PAGE_SORT,
  filterPages,
  hasPageChipFilters,
  hasPageFilters,
  isPageSort,
  PAGE_LIST_TABS,
  sortPages,
} from "@/lib/pages/filter-sort-pages";
import type { PageListTab } from "@/types/page";
import MemberAvatar from "./member-avatar";
import PageEmptyState from "./page-empty-state";
import PageFiltersMenu, {
  CREATED_WITHIN_KEYS,
  EMPTY_PAGE_FILTERS,
  type PageListFilterState,
} from "./page-filters-menu";
import PageListRow from "./page-list-row";
import PagesSortMenu from "./pages-sort-menu";
import { type PageMember, usePageMembers } from "./use-page-members";

export const PAGES_SORT_STORAGE_KEY = "margaya:pages-sort";

const TAB_KEYS: Record<PageListTab, string> = {
  public: "pages:list.tabs.public",
  private: "pages:list.tabs.private",
  archived: "pages:list.tabs.archived",
};

type PagesListProps = {
  workspaceId: string;
  projectId: string;
  tab: PageListTab;
  onTabChange: (tab: PageListTab) => void;
  /** "New page"; omitted without page:create. */
  onCreate?: () => void;
  isCreating?: boolean;
};

function RowSkeleton() {
  return (
    <div
      className="flex h-11 items-center gap-3 border-border/60 border-b px-4"
      aria-hidden="true"
    >
      <Skeleton className="size-4 rounded-sm" />
      <Skeleton className="h-3 w-2/5" />
      <span className="ms-auto flex gap-3">
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="size-3.5 rounded-full" />
      </span>
    </div>
  );
}

type ChipProps = {
  label: string;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
};

function FilterChip({ label, removeLabel, onRemove, children }: ChipProps) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border ps-2 pe-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {children}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={removeLabel}
        className="size-5 text-muted-foreground sm:size-5"
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}

/**
 * The Pages tab body: a 44px lens bar (Public / Private / Archived, then
 * search, sort and filters), the applied filters as chips, then 44px rows.
 */
export default function PagesList({
  workspaceId,
  projectId,
  tab,
  onTabChange,
  onCreate,
  isCreating,
}: PagesListProps) {
  const { t } = useTranslation();
  const pagesQuery = useGetPages(projectId);
  const favoritesQuery = useGetFavorites({ workspaceId });
  const { getMember } = usePageMembers(workspaceId);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // The field grows from the icon's 28px to 240px once it is in the DOM.
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [filters, setFilters] =
    useState<PageListFilterState>(EMPTY_PAGE_FILTERS);
  const [sort, setSort] = useStoredState(
    PAGES_SORT_STORAGE_KEY,
    DEFAULT_PAGE_SORT,
    isPageSort,
  );
  const untitled = t("pages:list.untitled");
  const pages = pagesQuery.data ?? [];
  const counts = useMemo(() => countPagesByTab(pages), [pages]);
  const byId = useMemo(() => indexPages(pages), [pages]);
  const favoriteIds = useMemo(
    () =>
      favoritesQuery.data
        ? new Set(
            favoritesQuery.data
              .filter((favorite) => favorite.entityType === "page")
              .map((favorite) => favorite.entityId),
          )
        : undefined,
    [favoritesQuery.data],
  );

  const owners = useMemo(() => {
    const list: PageMember[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      if (!page.ownerId || seen.has(page.ownerId)) continue;
      seen.add(page.ownerId);
      const member = getMember(page.ownerId);
      if (member) list.push(member);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [getMember, pages]);

  const rows = useMemo(
    () =>
      sortPages(
        filterPages(pages, {
          tab,
          query,
          ownerIds: filters.ownerIds,
          favoritesOnly: filters.favoritesOnly,
          favoriteIds,
          createdWithin: filters.createdWithin,
          untitledLabel: untitled,
        }),
        sort,
        untitled,
      ),
    [favoriteIds, filters, pages, query, sort, tab, untitled],
  );
  const filtersActive = hasPageFilters({ query, ...filters });
  const chipsActive = hasPageChipFilters(filters);
  const clearFilters = () => {
    setQuery("");
    setFilters(EMPTY_PAGE_FILTERS);
  };

  const openSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => {
      setSearchExpanded(true);
      searchInputRef.current?.focus();
    });
  };
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
    setSearchExpanded(false);
  };

  const renderChips = () => {
    if (!chipsActive) return null;
    const removeLabel = (filter: string) =>
      t("pages:filters.remove", { filter });
    return (
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-border/80 border-b px-3 py-1.5">
        {filters.favoritesOnly && (
          <FilterChip
            label={t("pages:filters.favorites")}
            removeLabel={removeLabel(t("pages:filters.favorites"))}
            onRemove={() => setFilters({ ...filters, favoritesOnly: false })}
          >
            <Star className="size-3 text-muted-foreground" aria-hidden="true" />
          </FilterChip>
        )}
        {filters.ownerIds.length > 0 && (
          <FilterChip
            label={t("pages:info.createdBy")}
            removeLabel={removeLabel(t("pages:info.createdBy"))}
            onRemove={() => setFilters({ ...filters, ownerIds: [] })}
          >
            {filters.ownerIds.map((ownerId) => {
              const owner = getMember(ownerId);
              const name = owner?.name ?? t("pages:history.unknownUser");
              return (
                <span key={ownerId} className="inline-flex items-center gap-1">
                  <MemberAvatar
                    name={name}
                    image={owner?.image}
                    className="size-4"
                  />
                  <span className="max-w-32 truncate">{name}</span>
                </span>
              );
            })}
          </FilterChip>
        )}
        {filters.createdWithin !== "any" && (
          <FilterChip
            label={t("pages:filters.createdDate")}
            removeLabel={removeLabel(t("pages:filters.createdDate"))}
            onRemove={() => setFilters({ ...filters, createdWithin: "any" })}
          >
            {t(CREATED_WITHIN_KEYS[filters.createdWithin])}
          </FilterChip>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setFilters(EMPTY_PAGE_FILTERS)}
        >
          {t("common:actions.clearAll")}
        </Button>
      </div>
    );
  };

  const renderBody = () => {
    if (pagesQuery.isLoading) {
      return (
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
            <RowSkeleton key={index} />
          ))}
        </div>
      );
    }
    if (pagesQuery.isError) {
      return (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyTitle>{t("pages:list.loadError")}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void pagesQuery.refetch()}
            >
              {t("pages:list.retry")}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    if (pages.length === 0) {
      return (
        <PageEmptyState
          kind="none"
          onCreate={onCreate}
          isCreating={isCreating}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <PageEmptyState
          kind={filtersActive ? "noMatch" : tab}
          onCreate={onCreate}
          isCreating={isCreating}
          onClearFilters={clearFilters}
        />
      );
    }
    return (
      <ul>
        {rows.map((page) => (
          <li key={page.id} className="border-border/60 border-b">
            <PageListRow
              page={page}
              workspaceId={workspaceId}
              owner={getMember(page.ownerId)}
              parentPath={pageAncestors(byId, page).map(
                (ancestor) => ancestor.title.trim() || untitled,
              )}
            />
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        className="min-h-11 py-0 md:px-3"
        trailing={
          <>
            {searchOpen ? (
              <div
                className="relative max-w-[calc(100vw-9rem)] shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: searchExpanded ? "15rem" : "1.75rem" }}
              >
                <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={query}
                  maxLength={100}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    if (query) setQuery("");
                    else closeSearch();
                  }}
                  onBlur={() => {
                    if (!query.trim()) closeSearch();
                  }}
                  placeholder={t("pages:list.searchPlaceholder")}
                  aria-label={t("pages:list.searchPlaceholder")}
                  className="h-7 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pr-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-[13px]"
                />
                {query && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("pages:filters.searchClear")}
                    className="-translate-y-1/2 absolute top-1/2 right-1 z-10 size-5 text-muted-foreground sm:size-5"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("pages:list.searchPlaceholder")}
                aria-expanded={false}
                className="text-muted-foreground"
                onClick={openSearch}
              >
                <Search className="size-3.5" />
              </Button>
            )}
            <PagesSortMenu sort={sort} onChange={setSort} />
            <PageFiltersMenu
              owners={owners}
              filters={filters}
              onChange={setFilters}
              favoritesReady={Boolean(favoriteIds)}
            />
          </>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as PageListTab)}
          className={cn("h-11 shrink-0", searchOpen && "max-sm:hidden")}
        >
          <TabsList variant="underline" className="h-11 gap-0 py-0">
            {PAGE_LIST_TABS.map((value) => (
              <TabsTab
                key={value}
                value={value}
                className="h-11 grow-0 gap-1.5 rounded-none px-3 font-medium text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-inset sm:h-11 sm:text-[13px]"
              >
                {t(TAB_KEYS[value])}
                <span className="font-normal text-muted-foreground text-xs tabular-nums">
                  {counts[value]}
                </span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </FilterBar>
      {renderChips()}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {renderBody()}
      </div>
    </div>
  );
}
