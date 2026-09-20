import type { PageListTab } from "@/types/page";

// The Pages list: which pages a tab shows, the search and owner filters,
// and the three sorts.

export type FilterablePage = {
  id: string;
  title: string;
  access: "public" | "private";
  ownerId: string | null;
  archivedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type PageSortField = "updatedAt" | "createdAt" | "title";
export type PageSort = { field: PageSortField; direction: "asc" | "desc" };

export const DEFAULT_PAGE_SORT: PageSort = {
  field: "updatedAt",
  direction: "desc",
};

export const PAGE_LIST_TABS: readonly PageListTab[] = [
  "public",
  "private",
  "archived",
];

export function isPageListTab(value: unknown): value is PageListTab {
  return (
    typeof value === "string" &&
    (PAGE_LIST_TABS as readonly string[]).includes(value)
  );
}

export function isPageSort(value: unknown): value is PageSort {
  if (typeof value !== "object" || value === null) return false;
  const { field, direction } = value as Record<string, unknown>;
  return (
    (field === "updatedAt" || field === "createdAt" || field === "title") &&
    (direction === "asc" || direction === "desc")
  );
}

export function pageTab(page: FilterablePage): PageListTab {
  if (page.archivedAt) return "archived";
  return page.access;
}

export function countPagesByTab(
  pages: readonly FilterablePage[],
): Record<PageListTab, number> {
  const counts: Record<PageListTab, number> = {
    public: 0,
    private: 0,
    archived: 0,
  };
  for (const page of pages) counts[pageTab(page)] += 1;
  return counts;
}

export type PageFilters = {
  tab: PageListTab;
  query: string;
  ownerIds: readonly string[];
  /** The localized "Untitled", so an empty title matches it. */
  untitledLabel: string;
};

export function hasPageFilters(
  filters: Pick<PageFilters, "query" | "ownerIds">,
): boolean {
  return filters.query.trim() !== "" || filters.ownerIds.length > 0;
}

export function filterPages<T extends FilterablePage>(
  pages: readonly T[],
  { tab, query, ownerIds, untitledLabel }: PageFilters,
): T[] {
  const needle = query.trim().toLowerCase();
  const owners = new Set(ownerIds);
  return pages.filter((page) => {
    if (pageTab(page) !== tab) return false;
    if (owners.size > 0 && !(page.ownerId && owners.has(page.ownerId))) {
      return false;
    }
    if (!needle) return true;
    const title = page.title.trim() || untitledLabel;
    return title.toLowerCase().includes(needle);
  });
}

function time(value: string | Date): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function sortPages<T extends FilterablePage>(
  pages: readonly T[],
  sort: PageSort,
  untitledLabel = "",
): T[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...pages].sort((a, b) => {
    let result: number;
    if (sort.field === "title") {
      result = (a.title.trim() || untitledLabel).localeCompare(
        b.title.trim() || untitledLabel,
        undefined,
        { sensitivity: "base" },
      );
    } else {
      result = time(a[sort.field]) - time(b[sort.field]);
    }
    if (result === 0) result = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return result * factor;
  });
}
