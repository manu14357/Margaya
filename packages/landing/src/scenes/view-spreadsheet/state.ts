import type { Priority } from "../../replica";
import type { ViewTask } from "../views-shared/data";

export type SpreadsheetViewState = {
  tasks: ViewTask[];
  /** The task whose priority picker is open. */
  editing: string | null;
  /** The last edited task, briefly highlighted. */
  edited: string | null;
  selected: string[];
};

export type SpreadsheetViewAction =
  | { type: "open"; id: string }
  | { type: "pick"; id: string; priority: Priority }
  | { type: "close" }
  | { type: "toggleSelect"; id: string };

export function spreadsheetViewReducer(
  state: SpreadsheetViewState,
  action: SpreadsheetViewAction,
): SpreadsheetViewState {
  switch (action.type) {
    case "open":
      return {
        ...state,
        editing: state.editing === action.id ? null : action.id,
      };
    case "pick":
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id ? { ...task, priority: action.priority } : task,
        ),
        editing: null,
        edited: action.id,
      };
    case "close":
      return { ...state, editing: null };
    case "toggleSelect":
      return {
        ...state,
        selected: state.selected.includes(action.id)
          ? state.selected.filter((id) => id !== action.id)
          : [...state.selected, action.id],
      };
  }
}
