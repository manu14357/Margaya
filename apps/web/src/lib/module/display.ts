import type { ModuleStatus } from "@/types/module";
import { isModuleStatus } from "./status";

// How the modules page shows the project's modules. Kept per project in
// localStorage; anything unreadable falls back to the defaults.

export type ModuleLayout = "list" | "gallery";

export const MODULE_ORDER_FIELDS = [
  "name",
  "progress",
  "tasks",
  "targetDate",
  "createdAt",
  "manual",
] as const;

export type ModuleOrderField = (typeof MODULE_ORDER_FIELDS)[number];

/** A field, descending with a leading "-"; manual order has no direction. */
export type ModuleOrder =
  | ModuleOrderField
  | `-${Exclude<ModuleOrderField, "manual">}`;

/** The lead filter value meaning "modules without a lead". */
export const MODULE_LEAD_NONE = "none";

export type ModuleFilters = {
  status: ModuleStatus[];
  lead: string[];
  members: string[];
};

export type ModuleDisplaySettings = {
  layout: ModuleLayout;
  groupByStatus: boolean;
  order: ModuleOrder;
  filters: ModuleFilters;
};

export const EMPTY_MODULE_FILTERS: ModuleFilters = {
  status: [],
  lead: [],
  members: [],
};

export const DEFAULT_MODULE_DISPLAY: ModuleDisplaySettings = {
  layout: "list",
  groupByStatus: true,
  order: "name",
  filters: EMPTY_MODULE_FILTERS,
};

export function moduleDisplayStorageKey(projectId: string) {
  return `margaya:module-display:${projectId}`;
}

export function orderFieldOf(order: ModuleOrder): ModuleOrderField {
  return (order.startsWith("-") ? order.slice(1) : order) as ModuleOrderField;
}

export function isDescendingOrder(order: ModuleOrder): boolean {
  return order.startsWith("-");
}

export function toModuleOrder(
  field: ModuleOrderField,
  descending: boolean,
): ModuleOrder {
  return field === "manual" || !descending ? field : `-${field}`;
}

function isModuleOrder(value: unknown): value is ModuleOrder {
  if (typeof value !== "string") return false;
  const field = value.startsWith("-") ? value.slice(1) : value;
  return (
    (MODULE_ORDER_FIELDS as readonly string[]).includes(field) &&
    value !== "-manual"
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}

/** Defensive parsing of a stored value; unknown parts become defaults. */
export function normalizeModuleDisplay(raw: unknown): ModuleDisplaySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_MODULE_DISPLAY;
  }
  const candidate = raw as Partial<
    Record<keyof ModuleDisplaySettings, unknown>
  >;
  const filters =
    candidate.filters &&
    typeof candidate.filters === "object" &&
    !Array.isArray(candidate.filters)
      ? (candidate.filters as Partial<Record<keyof ModuleFilters, unknown>>)
      : {};

  return {
    layout: candidate.layout === "gallery" ? "gallery" : "list",
    groupByStatus:
      typeof candidate.groupByStatus === "boolean"
        ? candidate.groupByStatus
        : DEFAULT_MODULE_DISPLAY.groupByStatus,
    order: isModuleOrder(candidate.order)
      ? candidate.order
      : DEFAULT_MODULE_DISPLAY.order,
    filters: {
      status: stringList(filters.status).filter(isModuleStatus),
      lead: stringList(filters.lead),
      members: stringList(filters.members),
    },
  };
}

export function hasModuleFilters(filters: ModuleFilters): boolean {
  return (
    filters.status.length > 0 ||
    filters.lead.length > 0 ||
    filters.members.length > 0
  );
}

type FilterableModule = {
  name: string;
  status: ModuleStatus;
  leadId: string | null;
  memberIds: readonly string[];
};

/** Status, lead and member filters (each "any of") plus a name search. */
export function filterModules<T extends FilterableModule>(
  modules: readonly T[],
  filters: ModuleFilters,
  search = "",
): T[] {
  const needle = search.trim().toLowerCase();
  return modules.filter((module) => {
    if (needle && !module.name.toLowerCase().includes(needle)) return false;
    if (filters.status.length > 0 && !filters.status.includes(module.status)) {
      return false;
    }
    if (
      filters.lead.length > 0 &&
      !filters.lead.includes(module.leadId ?? MODULE_LEAD_NONE)
    ) {
      return false;
    }
    if (
      filters.members.length > 0 &&
      !module.memberIds.some((id) => filters.members.includes(id))
    ) {
      return false;
    }
    return true;
  });
}

type SortableModule = {
  id: string;
  name: string;
  progress: number;
  counts: { total: number };
  targetDate: string | null;
  createdAt: string;
  position: number;
};

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function byName(a: SortableModule, b: SortableModule) {
  return nameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function compareField(
  field: ModuleOrderField,
  a: SortableModule,
  b: SortableModule,
): number {
  switch (field) {
    case "name":
      return nameCollator.compare(a.name, b.name);
    case "progress":
      return a.progress - b.progress;
    case "tasks":
      return a.counts.total - b.counts.total;
    case "createdAt":
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    case "manual":
      return a.position - b.position;
    default:
      return 0;
  }
}

/**
 * The page's order. Ties break by name, then id. Target dates without a
 * value go last in both directions.
 */
export function sortModules<T extends SortableModule>(
  modules: readonly T[],
  order: ModuleOrder,
): T[] {
  const field = orderFieldOf(order);
  const direction = isDescendingOrder(order) ? -1 : 1;
  return [...modules].sort((a, b) => {
    if (field === "targetDate") {
      if (a.targetDate !== b.targetDate) {
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate < b.targetDate ? -direction : direction;
      }
      return byName(a, b);
    }
    return direction * compareField(field, a, b) || byName(a, b);
  });
}
