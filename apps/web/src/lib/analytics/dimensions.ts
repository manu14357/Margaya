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
// and when it is offered. The API stays the authority on the values.

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

export const DATE_DIMENSIONS = [
  "createdAt",
  "completedAt",
  "startDate",
  "dueDate",
] as const satisfies readonly AnalyticsDimension[];

export type DateDimension = (typeof DATE_DIMENSIONS)[number];
export type CategoryDimension = Exclude<AnalyticsDimension, DateDimension>;

type DimensionFeature = "cycles" | "modules" | "estimates";

export type DimensionInfo = {
  key: AnalyticsDimension;
  labelKey: `analytics:dimensions.${AnalyticsDimension}`;
  /** "labels", "assignees", …: for the truncation and many-valued notes. */
  pluralKey?: `analytics:dimensionsPlural.${CategoryDimension}`;
  /** The copy of the dimension's `none` bucket, when it has one. */
  noneKey?: `analytics:none.${AnalyticsDimension}`;
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
  key: CategoryDimension,
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

export const DIMENSIONS: Record<AnalyticsDimension, DimensionInfo> = {
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

export function isAnalyticsDimension(
  value: unknown,
): value is AnalyticsDimension {
  return (
    typeof value === "string" &&
    (ANALYTICS_DIMENSIONS as readonly string[]).includes(value)
  );
}

export function isDateDimension(
  dimension: AnalyticsDimension,
): dimension is DateDimension {
  return DIMENSIONS[dimension].kind === "date";
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
};

type ProjectWithFlags = Partial<Record<ProjectFeatureField, boolean>>;

export function availabilityOf(
  projects: readonly ProjectWithFlags[],
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
  };
}

export function isDimensionAvailable(
  dimension: AnalyticsDimension,
  availability: DimensionAvailability,
): boolean {
  const info = DIMENSIONS[dimension];
  if (info.projects === "one" && availability.projectCount !== 1) return false;
  if (info.projects === "several" && availability.projectCount < 2) {
    return false;
  }
  if (info.feature && !availability.features[info.feature]) return false;
  return true;
}

/** The x-axis choices of a scope, in catalog order. */
export function availableDimensions(
  availability: DimensionAvailability,
): AnalyticsDimension[] {
  return ANALYTICS_DIMENSIONS.filter((dimension) =>
    isDimensionAvailable(dimension, availability),
  );
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
