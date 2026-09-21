import {
  removeRootCondition,
  rootConditions,
  setRootCondition,
  toggleConditionValue,
} from "./filter-tree";
import type { FilterNode } from "./model";

// The cycle and module sidebars' breakdown rows filter the board by status,
// assignee, priority and label. They speak the board's old filter shape;
// these helpers read and write it on the filter tree.

export type BoardFilters = {
  status: string[] | null;
  priority: string[] | null;
  assignee: string[] | null;
  dueDate: string[] | null;
  labels: string[] | null;
  customFields: Record<string, string[]> | null;
};

const BREAKDOWN_KEYS = {
  status: "status",
  assignee: "assignee",
  priority: "priority",
  labels: "label",
} as const;

/** The root "is any of" values of the breakdown subjects. */
export function boardFiltersFromTree(root: FilterNode | null): BoardFilters {
  const conditions = rootConditions(root);
  const valuesOf = (key: string) => {
    const condition = conditions.find(
      (candidate) => candidate.key === key && candidate.operator === "in",
    );
    return condition?.values?.length ? [...condition.values] : null;
  };
  return {
    status: valuesOf("status"),
    priority: valuesOf("priority"),
    assignee: valuesOf("assignee"),
    dueDate: null,
    labels: valuesOf("label"),
    customFields: null,
  };
}

/** Sets (or clears) a breakdown subject's values. */
export function applyBoardFilter(
  root: FilterNode | null,
  key: keyof BoardFilters,
  value: BoardFilters[keyof BoardFilters],
): FilterNode | null {
  const treeKey = BREAKDOWN_KEYS[key as keyof typeof BREAKDOWN_KEYS];
  if (!treeKey) return root;
  const values = Array.isArray(value) ? value : [];
  return values.length > 0
    ? setRootCondition(root, { key: treeKey, operator: "in", values })
    : removeRootCondition(root, treeKey);
}

/** Toggles one label value (a workspace label id or `name:` literal). */
export function toggleLabelFilter(
  root: FilterNode | null,
  value: string,
): FilterNode | null {
  return toggleConditionValue(root, "label", value);
}
