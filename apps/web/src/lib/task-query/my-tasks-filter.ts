import {
  findRootCondition,
  removeRootCondition,
  setRootCondition,
} from "./filter-tree";
import { type FilterNode, ME_VALUE } from "./model";

/** True when the assignee filter is exactly the current user. */
export function isMyTasksFilter(filters: FilterNode | null | undefined) {
  const condition = findRootCondition(filters, "assignee");
  return (
    condition?.operator === "in" &&
    condition.values?.length === 1 &&
    condition.values[0] === ME_VALUE
  );
}

/** Turns "my tasks" off, or on in place of any other assignee filter. */
export function toggleMyTasksFilter(filters: FilterNode | null | undefined) {
  return isMyTasksFilter(filters)
    ? removeRootCondition(filters, "assignee")
    : setRootCondition(filters, {
        key: "assignee",
        operator: "in",
        values: [ME_VALUE],
      });
}
