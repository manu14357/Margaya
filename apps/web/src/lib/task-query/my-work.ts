import { SUBSCRIBER_FILTER_AVAILABLE } from "./built-in-views";
import { DEFAULT_DISPLAY_PROPERTIES } from "./display";
import type { FilterCondition, FilterNode, TaskQueryState } from "./model";

// "Your work" (B4 §1.6): a summary and one list per relation to me.

export const MY_WORK_TABS = [
  "summary",
  "assigned",
  "created",
  "subscribed",
] as const;
export type MyWorkTab = (typeof MY_WORK_TABS)[number];
export type MyWorkListTab = Exclude<MyWorkTab, "summary">;

export function isMyWorkTab(value: unknown): value is MyWorkTab {
  return (
    typeof value === "string" &&
    (MY_WORK_TABS as readonly string[]).includes(value) &&
    (value !== "subscribed" || SUBSCRIBER_FILTER_AVAILABLE)
  );
}

export function visibleMyWorkTabs(): MyWorkTab[] {
  return MY_WORK_TABS.filter(isMyWorkTab);
}

const BASE_KEYS: Record<MyWorkListTab, string> = {
  assigned: "assignee",
  created: "createdBy",
  subscribed: "subscriber",
};

/** The tab's hidden condition: assigned to, created by or watched by me. */
export function myWorkBaseConditions(tab: MyWorkListTab): FilterCondition[] {
  return [{ key: BASE_KEYS[tab], operator: "in", values: ["me"] }];
}

/** A list grouped by group and ordered by due date. */
export function myWorkDefaultState(): TaskQueryState {
  return {
    filters: null,
    archived: "exclude",
    display: {
      layout: "list",
      groupBy: "group",
      subGroupBy: null,
      orderBy: { field: "dueDate", direction: "asc" },
      showSubTasks: true,
      showEmptyGroups: false,
    },
    displayProperties: { ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] },
  };
}

/** The states the summary groups your work by, in working order. */
export const MY_WORK_STATE_GROUPS = [
  "started",
  "unstarted",
  "backlog",
  "completed",
  "cancelled",
] as const;
export type MyWorkStateGroup = (typeof MY_WORK_STATE_GROUPS)[number];

const OPEN: FilterCondition = {
  key: "group",
  operator: "in",
  values: ["backlog", "unstarted", "started"],
};

/**
 * The filters a summary tile or row opens its tab with: open work, late
 * work, work due this week, work finished lately, or one project.
 */
export function presetFilters(preset: string): FilterNode | null {
  if (preset === "open") return { op: "and", children: [OPEN] };
  if (preset === "overdue") {
    return {
      op: "and",
      children: [OPEN, { key: "dueDate", operator: "in", values: ["past"] }],
    };
  }
  if (preset === "dueThisWeek") {
    return {
      op: "and",
      children: [
        OPEN,
        { key: "dueDate", operator: "in", values: ["thisWeek"] },
      ],
    };
  }
  if (preset === "completed30") {
    return {
      op: "and",
      children: [
        { key: "group", operator: "in", values: ["completed"] },
        {
          key: "completedAt",
          operator: "withinLast",
          amount: 30,
          unit: "days",
        },
      ],
    };
  }
  if (preset.startsWith("project:")) {
    const projectId = preset.slice("project:".length);
    return projectId
      ? {
          op: "and",
          children: [
            OPEN,
            { key: "project", operator: "in", values: [projectId] },
          ],
        }
      : null;
  }
  if (preset.startsWith("group:")) {
    const group = preset.slice("group:".length);
    return MY_WORK_STATE_GROUPS.includes(group as MyWorkStateGroup)
      ? {
          op: "and",
          children: [{ key: "group", operator: "in", values: [group] }],
        }
      : null;
  }
  if (preset.startsWith("priority:")) {
    const priority = preset.slice("priority:".length);
    return priority
      ? {
          op: "and",
          children: [
            OPEN,
            { key: "priority", operator: "in", values: [priority] },
          ],
        }
      : null;
  }
  return null;
}
