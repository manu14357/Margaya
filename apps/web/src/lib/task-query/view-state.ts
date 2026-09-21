import type { SavedView, UpdateViewRequest } from "@/types/view";
import {
  type DisplayScope,
  isArchivedFilter,
  normalizeDisplay,
  normalizeDisplayProperties,
} from "./display";
import type {
  DisplayProperties,
  FilterNode,
  TaskLayout,
  TaskQueryState,
} from "./model";

// A saved view stores the engine's filter and display model (B4 §4.2); the
// web edits it as a task list state.

export const WORKSPACE_VIEW_LAYOUTS: readonly TaskLayout[] = [
  "list",
  "board",
  "spreadsheet",
];

export const PROJECT_VIEW_LAYOUTS: readonly TaskLayout[] = [
  "list",
  "board",
  "spreadsheet",
  "calendar",
  "gantt",
];

export function viewScopeOf(view: Pick<SavedView, "projectId">): DisplayScope {
  return view.projectId ? "project" : "workspace";
}

/** The state a view opens with. */
export function viewToState(
  view: Pick<
    SavedView,
    "projectId" | "filters" | "display" | "displayProperties"
  >,
): TaskQueryState {
  const scope = viewScopeOf(view);
  return {
    filters: (view.filters.root as FilterNode | null) ?? null,
    archived: isArchivedFilter(view.filters.archived)
      ? view.filters.archived
      : "exclude",
    display: normalizeDisplay(
      view.display,
      scope,
      scope === "project" ? PROJECT_VIEW_LAYOUTS : WORKSPACE_VIEW_LAYOUTS,
    ),
    displayProperties: normalizeDisplayProperties(view.displayProperties),
  };
}

function propertiesPayload(properties: DisplayProperties) {
  const { customFields, ...flags } = properties;
  return { ...flags, customFields: [...customFields] };
}

/** The view content a state saves: filters, display and properties. */
export function stateToViewContent(
  state: TaskQueryState,
  scope: DisplayScope,
): Required<
  Pick<UpdateViewRequest, "filters" | "display" | "displayProperties">
> {
  const display = { ...state.display };
  if (
    scope === "workspace" &&
    !WORKSPACE_VIEW_LAYOUTS.includes(display.layout)
  ) {
    display.layout = "spreadsheet";
  }
  return {
    filters: { version: 1, root: state.filters, archived: state.archived },
    display,
    displayProperties:
      scope === "workspace"
        ? { ...propertiesPayload(state.displayProperties), customFields: [] }
        : propertiesPayload(state.displayProperties),
  };
}
