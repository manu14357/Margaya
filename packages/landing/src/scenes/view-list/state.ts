import type { StatusId } from "../../replica";
import type { ViewTask } from "../views-shared/data";

export type ListViewState = {
  tasks: ViewTask[];
  /** Collapsed status groups. */
  collapsed: StatusId[];
  /** Selected task ids, in the order they were picked. */
  selected: string[];
};

export type ListViewAction =
  | { type: "toggleGroup"; status: StatusId }
  | { type: "toggleSelect"; id: string }
  | { type: "clearSelection" };

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item)
    ? list.filter((entry) => entry !== item)
    : [...list, item];
}

export function listViewReducer(
  state: ListViewState,
  action: ListViewAction,
): ListViewState {
  switch (action.type) {
    case "toggleGroup":
      return { ...state, collapsed: toggle(state.collapsed, action.status) };
    case "toggleSelect":
      return { ...state, selected: toggle(state.selected, action.id) };
    case "clearSelection":
      return { ...state, selected: [] };
  }
}
