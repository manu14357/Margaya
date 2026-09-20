import {
  INTAKE_SORT_FIELDS,
  type IntakeCounts,
  type IntakeFilters,
  type IntakePriority,
  type IntakeSortField,
  type IntakeSortOrder,
  type IntakeStatus,
  type IntakeTab,
} from "@/types/intake";
import { defaultTabStatuses, tabStatuses } from "./intake";

// The Intake route's URL state (B7 §4.1). Defaults stay out of the URL and
// invalid values fall back to them, so shared links reproduce the view.

export const INTAKE_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "no-priority",
] as const satisfies readonly IntakePriority[];

export type IntakeSearch = {
  tab?: IntakeTab;
  item?: string;
  status?: IntakeStatus[];
  priority?: IntakePriority[];
  submittedBy?: string;
  q?: string;
  sortBy?: IntakeSortField;
  sortOrder?: IntakeSortOrder;
};

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",");
  return [];
}

function pick<T extends string>(allowed: readonly T[], value: unknown): T[] {
  const raw = listOf(value).map((entry) => entry.trim());
  return allowed.filter((entry) => raw.includes(entry));
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed || undefined;
}

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

export function validateIntakeSearch(
  search: Record<string, unknown>,
): IntakeSearch {
  const tab: IntakeTab = search.tab === "closed" ? "closed" : "open";
  const statuses = pick(tabStatuses(tab), search.status);
  const priorities = pick(INTAKE_PRIORITIES, search.priority);
  const sortBy = INTAKE_SORT_FIELDS.find((field) => field === search.sortBy);
  return {
    tab: tab === "closed" ? "closed" : undefined,
    item: text(search.item, 64),
    status:
      statuses.length > 0 && !sameSet(statuses, defaultTabStatuses(tab))
        ? statuses
        : undefined,
    priority: priorities.length > 0 ? priorities : undefined,
    submittedBy: text(search.submittedBy, 200),
    q: text(search.q, 100),
    sortBy: sortBy && sortBy !== "createdAt" ? sortBy : undefined,
    sortOrder: search.sortOrder === "asc" ? "asc" : undefined,
  };
}

export function resolveIntakeFilters(search: IntakeSearch): IntakeFilters {
  const tab = search.tab ?? "open";
  return {
    tab,
    statuses: search.status?.length
      ? search.status
      : [...defaultTabStatuses(tab)],
    priorities: search.priority ?? [],
    submittedBy: search.submittedBy,
    q: search.q,
    sortBy: search.sortBy ?? "createdAt",
    sortOrder: search.sortOrder ?? "desc",
  };
}

/** The URL form of filters, with defaults left out. */
export function toIntakeSearch(filters: IntakeFilters): IntakeSearch {
  return validateIntakeSearch({
    tab: filters.tab,
    status: filters.statuses,
    priority: filters.priorities,
    submittedBy: filters.submittedBy,
    q: filters.q,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  });
}

/** Filters beyond the tab's default statuses (the search box excluded). */
export function hasActiveIntakeFilters(filters: IntakeFilters): boolean {
  return (
    !sameSet(filters.statuses, defaultTabStatuses(filters.tab)) ||
    filters.priorities.length > 0 ||
    Boolean(filters.submittedBy)
  );
}

export type IntakeEmptyKind =
  | "noRequests"
  | "caughtUp"
  | "noClosed"
  | "noMatches"
  | "mine";

/** Which empty state an empty list shows (B7 §1.3). */
export function intakeEmptyKind({
  filters,
  counts,
  canReadAll,
}: {
  filters: IntakeFilters;
  counts: IntakeCounts | undefined;
  canReadAll: boolean;
}): IntakeEmptyKind {
  if (hasActiveIntakeFilters(filters) || filters.q) return "noMatches";
  const total = counts
    ? Object.values(counts).reduce((sum, value) => sum + value, 0)
    : 0;
  if (!canReadAll && total === 0) return "mine";
  if (filters.tab === "closed") return "noClosed";
  return total === 0 ? "noRequests" : "caughtUp";
}

/** The last sort per project, remembered in this browser. */
export function intakeSortStorageKey(projectId: string): string {
  return `margaya:intake-sort:${projectId}`;
}

export function readStoredIntakeSort(
  projectId: string,
): Pick<IntakeSearch, "sortBy" | "sortOrder"> | null {
  try {
    const raw = window.localStorage.getItem(intakeSortStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { sortBy, sortOrder } = validateIntakeSearch(parsed);
    return { sortBy, sortOrder };
  } catch {
    return null;
  }
}

export function storeIntakeSort(
  projectId: string,
  sort: { sortBy: IntakeSortField; sortOrder: IntakeSortOrder },
): void {
  try {
    window.localStorage.setItem(
      intakeSortStorageKey(projectId),
      JSON.stringify(sort),
    );
  } catch {
    // Storage may be full or blocked; the URL still holds the sort.
  }
}
