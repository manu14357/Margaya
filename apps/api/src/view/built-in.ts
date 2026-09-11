import { type FilterKeyRegistry, filterKeyRegistry } from "../task-query/keys";
import type { FilterNode } from "../task-query/schema";
import { filterConditions } from "../task-query/validate";
import {
  defaultViewDisplay,
  defaultViewDisplayProperties,
  defaultViewFilters,
} from "./normalize";

// The built-in workspace views are static definitions, not rows (B4 K12).
// Each has a fixed base condition that is AND-ed with the (locally tweaked)
// filters. A built-in whose filter key no slice has registered yet (the
// Subscribed view before subscriptions exist) is left out.

type BuiltInDefinition = {
  key: string;
  name: string;
  baseFilter: FilterNode | null;
};

const BUILT_IN_VIEWS: readonly BuiltInDefinition[] = [
  { key: "all", name: "All tasks", baseFilter: null },
  {
    key: "assigned",
    name: "Assigned to me",
    baseFilter: { key: "assignee", operator: "in", values: ["me"] },
  },
  {
    key: "created",
    name: "Created by me",
    baseFilter: { key: "createdBy", operator: "in", values: ["me"] },
  },
  {
    key: "subscribed",
    name: "Subscribed",
    baseFilter: { key: "subscriber", operator: "in", values: ["me"] },
  },
];

export function listBuiltInViews(
  registry: FilterKeyRegistry = filterKeyRegistry,
) {
  return BUILT_IN_VIEWS.filter((view) =>
    filterConditions(view.baseFilter).every((condition) =>
      registry.has(condition.key),
    ),
  ).map((view) => ({
    ...view,
    filters: defaultViewFilters(),
    display: defaultViewDisplay("workspace"),
    displayProperties: defaultViewDisplayProperties(),
  }));
}
