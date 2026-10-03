import { Search } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import { indexPages, pageAncestors } from "@/lib/pages/build-page-tree";
import {
  countPagesByTab,
  DEFAULT_PAGE_SORT,
  filterPages,
  hasPageFilters,
  isPageSort,
  PAGE_LIST_TABS,
  sortPages,
} from "@/lib/pages/filter-sort-pages";
import type { PageListTab } from "@/types/page";
import PageEmptyState from "./page-empty-state";
import PageListRow from "./page-list-row";
import PageOwnerFilter from "./page-owner-filter";
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

/**
 * The Pages tab body: a lens bar (Public / Private / Archived, search,
 * owner and sort), then compact rows under a sticky header.
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
  const { getMember } = usePageMembers(workspaceId);
  const [query, setQuery] = useState("");
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [sort, setSort] = useStoredState(
    PAGES_SORT_STORAGE_KEY,
    DEFAULT_PAGE_SORT,
    isPageSort,
  );
  const untitled = t("pages:list.untitled");
  const pages = pagesQuery.data ?? [];
  const counts = useMemo(() => countPagesByTab(pages), [pages]);
  const byId = useMemo(() => indexPages(pages), [pages]);

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
        filterPages(pages, { tab, query, ownerIds, untitledLabel: untitled }),
        sort,
        untitled,
      ),
    [ownerIds, pages, query, sort, tab, untitled],
  );
  const filtersActive = hasPageFilters({ query, ownerIds });
  const clearFilters = () => {
    setQuery("");
    setOwnerIds([]);
  };

  const renderBody = () => {
    if (pagesQuery.isLoading) {
      return (
        <div className="space-y-1 px-4 py-2" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
            <Skeleton key={index} className="h-7 w-full" />
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
      <>
        <div
          aria-hidden="true"
          className="sticky top-0 z-10 flex h-8 items-center gap-3 border-border/60 border-b bg-muted px-4 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
        >
          <span className="min-w-0 flex-1 ps-7">
            {t("pages:list.sort.name")}
          </span>
          <span className="hidden w-32 sm:block">
            {tab === "archived"
              ? t("pages:list.tabs.archived")
              : t("pages:list.sort.lastEdited")}
          </span>
          <span className="w-30 shrink-0" />
        </div>
        <ul>
          {rows.map((page) => (
            <li
              key={page.id}
              className="relative after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/60 last:after:hidden"
            >
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
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        trailing={
          <>
            <PageOwnerFilter
              owners={owners}
              selected={ownerIds}
              onChange={setOwnerIds}
            />
            <PagesSortMenu sort={sort} onChange={setSort} />
          </>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as PageListTab)}
          className="shrink-0"
        >
          <TabsList className="h-7.5">
            {PAGE_LIST_TABS.map((value) => (
              <TabsTab
                key={value}
                value={value}
                className="h-6.5 grow-0 gap-1.5 px-2 text-xs sm:h-6.5 sm:text-xs"
              >
                {t(TAB_KEYS[value])}
                <span className="text-muted-foreground tabular-nums">
                  {counts[value]}
                </span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-40 shrink-0 sm:w-56">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder={t("pages:list.searchPlaceholder")}
            aria-label={t("pages:list.searchPlaceholder")}
            className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
          />
        </div>
      </FilterBar>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {renderBody()}
      </div>
    </div>
  );
}
