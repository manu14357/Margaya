import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarArrowUp,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Columns3,
  FolderKanban,
  IterationCw,
  Layers,
  Ruler,
  SignalHigh,
  SlidersHorizontal,
  Tag,
  UserPen,
  UserRound,
} from "lucide-react";
import {
  isProjectFeatureEnabled,
  type ProjectFeatureField,
} from "@/constants/project-features";
import type { AnalyticsDimension } from "@/types/analytics";

// The web's dimension catalog (B8 §2A.1): how each dimension reads, draws
// and when it is offered. The API stays the authority on the values. A
// project's dropdown custom fields are dimensions too (`customField:<id>`),
// offered while exactly one project is in scope, like status.

export const ANALYTICS_DIMENSIONS = [
  "status",
  "group",
  "priority",
  "assignee",
  "createdBy",
  "label",
  "cycle",
  "module",
  "estimate",
  "project",
  "createdAt",
  "completedAt",
  "startDate",
  "dueDate",
] as const satisfies readonly AnalyticsDimension[];

export type BuiltInDimension = (typeof ANALYTICS_DIMENSIONS)[number];
export type CustomFieldDimension = Exclude<
  AnalyticsDimension,
  BuiltInDimension
>;

export const CUSTOM_FIELD_DIMENSION_PREFIX = "customField:";
const CUSTOM_FIELD_DIMENSION_PATTERN = /^customField:[\w-]{1,128}$/;

export function isCustomFieldDimension(
  value: unknown,
): value is CustomFieldDimension {
  return (
    typeof value === "string" && CUSTOM_FIELD_DIMENSION_PATTERN.test(value)
  );
}

export function customFieldDimension(fieldId: string): CustomFieldDimension {
  return `${CUSTOM_FIELD_DIMENSION_PREFIX}${fieldId}` as CustomFieldDimension;
}

export function fieldIdOfDimension(dimension: CustomFieldDimension): string {
  return dimension.slice(CUSTOM_FIELD_DIMENSION_PREFIX.length);
}

/** A custom field of the project in scope, as analytics offers it. */
export type AnalyticsField = { id: string; name: string; type: string };

export const DATE_DIMENSIONS = [
  "createdAt",
  "completedAt",
  "startDate",
  "dueDate",
] as const satisfies readonly AnalyticsDimension[];

export type DateDimension = (typeof DATE_DIMENSIONS)[number];
export type CategoryDimension = Exclude<AnalyticsDimension, DateDimension>;

type DimensionFeature = "cycles" | "modules" | "estimates";
/** The catalog entries; every custom field dimension shares one. */
type CatalogKey = BuiltInDimension | "customField";
type CategoryCatalogKey = Exclude<CatalogKey, DateDimension>;

export type DimensionInfo = {
  key: CatalogKey;
  /** The generic name; a custom field reads as its own name instead. */
  labelKey: `analytics:dimensions.${CatalogKey}`;
  /** "labels", "assignees", …: for the truncation and many-valued notes. */
  pluralKey?: `analytics:dimensionsPlural.${CategoryCatalogKey}`;
  /** The copy of the dimension's `none` bucket, when it has one. */
  noneKey?: `analytics:none.${CatalogKey}`;
  icon: LucideIcon;
  kind: "date" | "category";
  /** A task can hold several keys (assignees, labels, modules). */
  many: boolean;
  /** The builder's default for "Sort by value". */
  defaultSort: "natural" | "value";
  /** Offered only while a scope project has this feature on. */
  feature?: DimensionFeature;
  /** status needs exactly one project; project needs more than one. */
  projects?: "one" | "several";
};

function category(
  key: CategoryCatalogKey,
  icon: LucideIcon,
  options: Partial<DimensionInfo> = {},
): DimensionInfo {
  return {
    key,
    labelKey: `analytics:dimensions.${key}`,
    icon,
    kind: "category",
    many: false,
    defaultSort: "natural",
    ...options,
  };
}

function dated(
  key: DateDimension,
  icon: LucideIcon,
  hasNone: boolean,
): DimensionInfo {
  return {
    key,
    labelKey: `analytics:dimensions.${key}`,
    noneKey: hasNone ? `analytics:none.${key}` : undefined,
    icon,
    kind: "date",
    many: false,
    defaultSort: "natural",
  };
}

export const DIMENSIONS: Record<BuiltInDimension, DimensionInfo> = {
  status: category("status", Columns3, {
    pluralKey: "analytics:dimensionsPlural.status",
    projects: "one",
  }),
  group: category("group", Layers),
  priority: category("priority", SignalHigh),
  assignee: category("assignee", UserRound, {
    pluralKey: "analytics:dimensionsPlural.assignee",
    noneKey: "analytics:none.assignee",
    many: true,
    defaultSort: "value",
  }),
  createdBy: category("createdBy", UserPen, {
    pluralKey: "analytics:dimensionsPlural.createdBy",
    noneKey: "analytics:none.createdBy",
    defaultSort: "value",
  }),
  label: category("label", Tag, {
    pluralKey: "analytics:dimensionsPlural.label",
    noneKey: "analytics:none.label",
    many: true,
    defaultSort: "value",
  }),
  cycle: category("cycle", IterationCw, {
    pluralKey: "analytics:dimensionsPlural.cycle",
    noneKey: "analytics:none.cycle",
    feature: "cycles",
  }),
  module: category("module", Boxes, {
    pluralKey: "analytics:dimensionsPlural.module",
    noneKey: "analytics:none.module",
    many: true,
    defaultSort: "value",
    feature: "modules",
  }),
  estimate: category("estimate", Ruler, {
    pluralKey: "analytics:dimensionsPlural.estimate",
    noneKey: "analytics:none.estimate",
    feature: "estimates",
  }),
  project: category("project", FolderKanban, {
    pluralKey: "analytics:dimensionsPlural.project",
    defaultSort: "value",
    projects: "several",
  }),
  createdAt: dated("createdAt", CalendarPlus, false),
  completedAt: dated("completedAt", CalendarCheck, true),
  startDate: dated("startDate", CalendarArrowUp, true),
  dueDate: dated("dueDate", CalendarClock, true),
};

const CUSTOM_FIELD_INFO = category("customField", SlidersHorizontal, {
  pluralKey: "analytics:dimensionsPlural.customField",
  noneKey: "analytics:none.customField",
  projects: "one",
});

export function dimensionInfo(dimension: AnalyticsDimension): DimensionInfo {
  return isCustomFieldDimension(dimension)
    ? CUSTOM_FIELD_INFO
    : DIMENSIONS[dimension];
}

/** A dimension's name: a custom field's own, else the catalog's. */
export function dimensionLabel(
  dimension: AnalyticsDimension,
  t: (key: string) => string,
  fields?: readonly Pick<AnalyticsField, "id" | "name">[],
): string {
  if (isCustomFieldDimension(dimension)) {
    const id = fieldIdOfDimension(dimension);
    const found = fields?.find((field) => field.id === id);
    if (found) return found.name;
  }
  return t(dimensionInfo(dimension).labelKey);
}

export function isAnalyticsDimension(
  value: unknown,
): value is AnalyticsDimension {
  return (
    (typeof value === "string" &&
      (ANALYTICS_DIMENSIONS as readonly string[]).includes(value)) ||
    isCustomFieldDimension(value)
  );
}

export function isDateDimension(
  dimension: AnalyticsDimension,
): dimension is DateDimension {
  return dimensionInfo(dimension).kind === "date";
}

/** Dates run left to right; names read best as horizontal rows. */
export function orientationOf(
  dimension: AnalyticsDimension,
): "vertical" | "horizontal" {
  return isDateDimension(dimension) ? "vertical" : "horizontal";
}

/** What a scope offers: how many projects, and which features any has on. */
export type DimensionAvailability = {
  projectCount: number;
  features: Record<DimensionFeature, boolean>;
  /**
   * The custom fields of the one project in scope: none with several
   * projects, undefined while they load.
   */
  customFields?: readonly AnalyticsField[];
};

type ProjectWithFlags = Partial<Record<ProjectFeatureField, boolean>>;

export function availabilityOf(
  projects: readonly ProjectWithFlags[],
  /** The fields of the one project in scope, once loaded. */
  customFields?: readonly AnalyticsField[],
): DimensionAvailability {
  const any = (feature: DimensionFeature) =>
    projects.some((project) => isProjectFeatureEnabled(project, feature));
  return {
    projectCount: projects.length,
    features: {
      cycles: any("cycles"),
      modules: any("modules"),
      estimates: any("estimates"),
    },
    customFields: projects.length === 1 ? customFields : [],
  };
}

/** The scope's fields are still loading, so a stored one can't be checked. */
export function fieldsPending(availability: DimensionAvailability): boolean {
  return availability.projectCount === 1 && !availability.customFields;
}

/** The scope's fields of one type, in the project's order. */
export function fieldsOfType(
  availability: DimensionAvailability,
  type: "dropdown" | "number",
): AnalyticsField[] {
  if (availability.projectCount !== 1) return [];
  return (availability.customFields ?? []).filter(
    (field) => field.type === type,
  );
}

export function isDimensionAvailable(
  dimension: AnalyticsDimension,
  availability: DimensionAvailability,
): boolean {
  const info = dimensionInfo(dimension);
  if (info.projects === "one" && availability.projectCount !== 1) return false;
  if (info.projects === "several" && availability.projectCount < 2) {
    return false;
  }
  if (info.feature && !availability.features[info.feature]) return false;
  if (isCustomFieldDimension(dimension)) {
    const id = fieldIdOfDimension(dimension);
    return fieldsOfType(availability, "dropdown").some(
      (field) => field.id === id,
    );
  }
  return true;
}

/** The scope's dropdown fields, as dimensions. */
export function customFieldDimensions(
  availability: DimensionAvailability,
): CustomFieldDimension[] {
  return fieldsOfType(availability, "dropdown").map((field) =>
    customFieldDimension(field.id),
  );
}

/**
 * The x-axis choices of a scope: the catalog's categories, the project's
 * dropdown fields, then the dates.
 */
export function availableDimensions(
  availability: DimensionAvailability,
): AnalyticsDimension[] {
  const builtIn = ANALYTICS_DIMENSIONS.filter((dimension) =>
    isDimensionAvailable(dimension, availability),
  );
  const categories = builtIn.filter((dimension) => !isDateDimension(dimension));
  const dates = builtIn.filter((dimension) => isDateDimension(dimension));
  return [...categories, ...customFieldDimensions(availability), ...dates];
}

/** Segments: available category dimensions other than the x-axis. */
export function segmentOptions(
  xAxis: AnalyticsDimension,
  availability: DimensionAvailability,
): CategoryDimension[] {
  return availableDimensions(availability).filter(
    (dimension): dimension is CategoryDimension =>
      dimension !== xAxis && !isDateDimension(dimension),
  );
}
