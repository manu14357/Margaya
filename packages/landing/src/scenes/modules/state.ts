import type { GroupCounts } from "../../replica";

export const MODULE_STATUSES = [
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
] as const;

export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export type ModuleItem = {
  id: string;
  name: string;
  dates: string;
  status: ModuleStatus;
  lead: string | null;
  counts: GroupCounts;
};

export type ModulesLayout = "list" | "gallery";

export type ModulesState = {
  modules: ModuleItem[];
  layout: ModulesLayout;
  /** The module whose status popover is open. */
  menuFor: string | null;
};

export type ModulesAction =
  | { type: "layout"; layout: ModulesLayout }
  | { type: "openStatus"; id: string }
  | { type: "closeStatus" }
  | { type: "setStatus"; id: string; status: ModuleStatus };

export function moduleScope(counts: GroupCounts): number {
  return counts.completed + counts.started + counts.unstarted + counts.backlog;
}

/** Completed share of the scope, rounded, like the app's module progress. */
export function moduleProgress(counts: GroupCounts): number {
  const scope = moduleScope(counts);
  return scope > 0 ? Math.round((counts.completed / scope) * 100) : 0;
}

export function modulesReducer(
  state: ModulesState,
  action: ModulesAction,
): ModulesState {
  switch (action.type) {
    case "layout":
      return { ...state, layout: action.layout, menuFor: null };
    case "openStatus":
      return {
        ...state,
        menuFor: state.menuFor === action.id ? null : action.id,
      };
    case "closeStatus":
      return { ...state, menuFor: null };
    case "setStatus":
      return {
        ...state,
        menuFor: null,
        modules: state.modules.map((module) =>
          module.id === action.id
            ? { ...module, status: action.status }
            : module,
        ),
      };
  }
}
