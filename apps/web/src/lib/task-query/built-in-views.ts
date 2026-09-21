import { DEFAULT_DISPLAY_PROPERTIES, defaultDisplay } from "./display";
import { type FilterCondition, ME_VALUE, type TaskQueryState } from "./model";

// The built-in workspace views (B4 §6.7): static definitions, not rows. A
// hidden base condition scopes each one; personal tweaks stay in the
// browser under `view:builtin:{key}` and "Save as new view" copies them.

export const BUILT_IN_VIEW_KEYS = [
  "all",
  "assigned",
  "created",
  "subscribed",
] as const;
export type BuiltInViewKey = (typeof BUILT_IN_VIEW_KEYS)[number];

/**
 * The engine answers the `subscriber` filter since B10 registered it; the
 * Subscribed view and tab depend on it.
 */
export const SUBSCRIBER_FILTER_AVAILABLE = true;

export type BuiltInView = {
  key: BuiltInViewKey;
  nameKey: `views:builtIn.${BuiltInViewKey}`;
  baseConditions: FilterCondition[];
  state: TaskQueryState;
};

function workspaceState(): TaskQueryState {
  return {
    filters: null,
    archived: "exclude",
    display: defaultDisplay("workspace"),
    displayProperties: { ...DEFAULT_DISPLAY_PROPERTIES, customFields: [] },
  };
}

const meCondition = (key: string): FilterCondition => ({
  key,
  operator: "in",
  values: [ME_VALUE],
});

const DEFINITIONS: Record<BuiltInViewKey, Omit<BuiltInView, "state">> = {
  all: { key: "all", nameKey: "views:builtIn.all", baseConditions: [] },
  assigned: {
    key: "assigned",
    nameKey: "views:builtIn.assigned",
    baseConditions: [meCondition("assignee")],
  },
  created: {
    key: "created",
    nameKey: "views:builtIn.created",
    baseConditions: [meCondition("createdBy")],
  },
  subscribed: {
    key: "subscribed",
    nameKey: "views:builtIn.subscribed",
    baseConditions: [meCondition("subscriber")],
  },
};

export function isBuiltInViewKey(value: unknown): value is BuiltInViewKey {
  return (
    typeof value === "string" &&
    (BUILT_IN_VIEW_KEYS as readonly string[]).includes(value) &&
    (value !== "subscribed" || SUBSCRIBER_FILTER_AVAILABLE)
  );
}

export function getBuiltInView(key: BuiltInViewKey): BuiltInView {
  return { ...DEFINITIONS[key], state: workspaceState() };
}

/** The built-ins offered, in tab order. */
export function builtInViews(): BuiltInView[] {
  return BUILT_IN_VIEW_KEYS.filter(isBuiltInViewKey).map(getBuiltInView);
}
