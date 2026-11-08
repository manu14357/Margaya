import { HTTPException } from "hono/http-exception";
import { compileFilterTree } from "../task-query/compile";
import type { QueryContext } from "../task-query/context";
import { type FilterKeyRegistry, filterKeyRegistry } from "../task-query/keys";
import {
  GROUP_BY_STATUS_NEEDS_ONE_PROJECT,
  GROUPS_MUST_DIFFER,
} from "../task-query/run";
import { isCustomFieldDisplayKey } from "../task-query/schema";
import { filterConditions, validateFilterTree } from "../task-query/validate";
import { todayUtc } from "../utils/calendar-date";
import {
  type ViewDisplay,
  type ViewDisplayProperties,
  type ViewFilters,
  type ViewScope,
  WORKSPACE_VIEW_LAYOUTS,
} from "./types";

// Content rules a view must pass before it is stored (B4 §5.4), apart from
// the references to other rows (references.ts). The filter tree goes through
// the engine's own validator and compiler, so whatever a view stores can run.

export const WORKSPACE_VIEW_STATUS =
  "Workspace views can't filter by status; use group instead";
export const WORKSPACE_VIEW_LAYOUT =
  "Workspace views use the list, board, spreadsheet or gantt layout";
export const WORKSPACE_VIEW_CUSTOM_FIELDS =
  "Custom field columns need a project view";
export const WORKSPACE_VIEW_CUSTOM_FIELD_DISPLAY =
  "Grouping or sorting by a custom field needs a project view";

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

/**
 * A context with no projects: compiling against it runs every key's own
 * checks (for example, whose subscriptions may be filtered) without a query.
 */
function dryRunContext(workspaceId: string, userId: string): QueryContext {
  const today = todayUtc();
  return {
    workspaceId,
    userId,
    publicContext: false,
    timeZone: "UTC",
    weekStartsOn: 0,
    today,
    utcToday: today,
    projects: [],
    projectIds: [],
    projectById: new Map(),
    featureProjectIds: { cycles: [], modules: [], estimates: [] },
    customFields: new Map(),
  };
}

export function assertViewFilters(
  filters: ViewFilters,
  {
    scope,
    workspaceId,
    userId,
    registry = filterKeyRegistry,
  }: {
    scope: ViewScope;
    workspaceId: string;
    userId: string;
    registry?: FilterKeyRegistry;
  },
): void {
  validateFilterTree(filters.root, registry);
  if (
    scope === "workspace" &&
    filterConditions(filters.root).some(
      (condition) => condition.key === "status",
    )
  ) {
    badRequest(WORKSPACE_VIEW_STATUS);
  }
  compileFilterTree(filters.root, dryRunContext(workspaceId, userId), registry);
}

export function assertViewDisplay(
  display: ViewDisplay,
  scope: ViewScope,
): void {
  if (
    display.subGroupBy &&
    (!display.groupBy || display.subGroupBy === display.groupBy)
  ) {
    badRequest(GROUPS_MUST_DIFFER);
  }
  if (scope === "workspace") {
    if (display.groupBy === "status" || display.subGroupBy === "status") {
      badRequest(GROUP_BY_STATUS_NEEDS_ONE_PROJECT);
    }
    if (
      [display.groupBy, display.subGroupBy, display.orderBy.field].some(
        isCustomFieldDisplayKey,
      )
    ) {
      badRequest(WORKSPACE_VIEW_CUSTOM_FIELD_DISPLAY);
    }
    if (!WORKSPACE_VIEW_LAYOUTS.includes(display.layout)) {
      badRequest(WORKSPACE_VIEW_LAYOUT);
    }
  }
}

export function assertViewDisplayProperties(
  properties: ViewDisplayProperties,
  scope: ViewScope,
): void {
  if (scope === "workspace" && properties.customFields.length > 0) {
    badRequest(WORKSPACE_VIEW_CUSTOM_FIELDS);
  }
}
