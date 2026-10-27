import type { PageListTab } from "@/types/page";

// The Pages list: which pages a tab shows, the search, owner, favorites and
// created-date filters, and the three sorts.

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

export const CREATED_WITHIN = [
  "any",
  "today",
  "last7",
  "last30",
  "older",
] as const;
export type CreatedWithin = (typeof CREATED_WITHIN)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether `createdAt` falls in the window, seen from `now`: "today" since
 * local midnight, "last7"/"last30" within that many days, "older" before
 * the last 30 days.
 */
export function isCreatedWithin(
  createdAt: string | Date,
  within: CreatedWithin,
  now: Date = new Date(),
): boolean {
  if (within === "any") return true;
  const created = time(createdAt);
  if (within === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return created >= midnight.getTime();
  }
  const thirtyDaysAgo = now.getTime() - 30 * DAY_MS;
  if (within === "older") return created < thirtyDaysAgo;
  const days = within === "last7" ? 7 : 30;
  return created >= now.getTime() - days * DAY_MS;
}

export type PageFilters = {
  tab: PageListTab;
  query: string;
  ownerIds: readonly string[];
  /** Only the user's favorites; ignored until `favoriteIds` is known. */
  favoritesOnly?: boolean;
  favoriteIds?: ReadonlySet<string>;
  createdWithin?: CreatedWithin;
  /** "Now" for the created-date window (tests pin it). */
  now?: Date;
  /** The localized "Untitled", so an empty title matches it. */
  untitledLabel: string;
};

/** The filters chips stand for: everything but the search text. */
export function hasPageChipFilters(
  filters: Pick<PageFilters, "ownerIds" | "favoritesOnly" | "createdWithin">,
): boolean {
  return (
    filters.ownerIds.length > 0 ||
    Boolean(filters.favoritesOnly) ||
    (filters.createdWithin ?? "any") !== "any"
  );
}

export function hasPageFilters(
  filters: Pick<
    PageFilters,
    "query" | "ownerIds" | "favoritesOnly" | "createdWithin"
  >,
): boolean {
  return filters.query.trim() !== "" || hasPageChipFilters(filters);
}

export function filterPages<T extends FilterablePage>(
  pages: readonly T[],
  {
    tab,
    query,
    ownerIds,
    favoritesOnly,
    favoriteIds,
    createdWithin = "any",
    now = new Date(),
    untitledLabel,
  }: PageFilters,
): T[] {
  const needle = query.trim().toLowerCase();
  const owners = new Set(ownerIds);
  return pages.filter((page) => {
    if (pageTab(page) !== tab) return false;
    if (owners.size > 0 && !(page.ownerId && owners.has(page.ownerId))) {
      return false;
    }
    if (favoritesOnly && favoriteIds && !favoriteIds.has(page.id)) {
      return false;
    }
    if (!isCreatedWithin(page.createdAt, createdWithin, now)) return false;
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
