import type { StatusId } from "../../replica";
import { moveToStatus, type ViewTask } from "../views-shared/data";

export type BoardViewState = { tasks: ViewTask[] };

export type BoardViewAction = { type: "move"; id: string; status: StatusId };

export function boardViewReducer(
  state: BoardViewState,
  action: BoardViewAction,
): BoardViewState {
  switch (action.type) {
    case "move":
      return { tasks: moveToStatus(state.tasks, action.id, action.status) };
  }
}
