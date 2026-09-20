import {
  INBOX_TABS,
  INBOX_TYPES,
  INBOX_VIEWS,
  type InboxFilters,
  type InboxTab,
  type InboxType,
  type InboxView,
} from "@/types/notification";

// The inbox route's URL state (B10 §4.1). Defaults are left out of the URL,
// and invalid values fall back to them.

export type InboxSearch = {
  tab?: InboxTab;
  view?: InboxView;
  unread?: boolean;
  types?: InboxType[];
  notificationId?: string;
};

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === "string" &&
    (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function parseTypes(value: unknown): InboxType[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const types = INBOX_TYPES.filter((type) => raw.includes(type));
  return types.length > 0 ? types : undefined;
}

export function validateInboxSearch(
  search: Record<string, unknown>,
): InboxSearch {
  const tab = oneOf(INBOX_TABS, search.tab);
  const view = oneOf(INBOX_VIEWS, search.view);
  const unread = search.unread === true || search.unread === "true";
  return {
    tab: tab === "all" ? undefined : tab,
    view: view === "inbox" ? undefined : view,
    unread: unread || undefined,
    types: parseTypes(search.types),
    notificationId:
      typeof search.notificationId === "string" && search.notificationId
        ? search.notificationId
        : undefined,
  };
}

export function resolveInboxFilters(search: InboxSearch): InboxFilters {
  return {
    tab: search.tab ?? "all",
    view: search.view ?? "inbox",
    unread: search.unread === true,
    types: search.types ?? [],
  };
}

/** The URL form of filters: defaults dropped. */
export function toInboxSearch(
  filters: InboxFilters,
): Omit<InboxSearch, "notificationId"> {
  return {
    tab: filters.tab === "all" ? undefined : filters.tab,
    view: filters.view === "inbox" ? undefined : filters.view,
    unread: filters.unread || undefined,
    types: filters.types.length > 0 ? filters.types : undefined,
  };
}

export function hasActiveInboxFilters(filters: InboxFilters) {
  return filters.unread || filters.types.length > 0;
}

export type InboxEmptyKind =
  | "all"
  | "mentions"
  | "unread"
  | "snoozed"
  | "archived"
  | "filtered";

/** Which empty state an empty list shows (B10 §1.7). */
export function inboxEmptyKind(filters: InboxFilters): InboxEmptyKind {
  if (filters.types.length > 0) return "filtered";
  if (filters.view === "snoozed") return "snoozed";
  if (filters.view === "archived") return "archived";
  if (filters.unread) return "unread";
  return filters.tab === "mentions" ? "mentions" : "all";
}
