export type TrashItemId = "pricing" | "banner" | "legacy";

export type TrashState = {
  view: "trash" | "board";
  /** Still in Recently deleted, newest first. */
  trashed: TrashItemId[];
  /** Restored, newest first: back on the board in To do. */
  restored: TrashItemId[];
  toast: boolean;
};

export type TrashAction =
  | { type: "restore"; id: TrashItemId }
  | { type: "openBoard" }
  | { type: "openTrash" };

export const initialTrashState: TrashState = {
  view: "trash",
  trashed: ["pricing", "banner", "legacy"],
  restored: [],
  toast: false,
};

export function trashReducer(
  state: TrashState,
  action: TrashAction,
): TrashState {
  switch (action.type) {
    case "restore":
      if (!state.trashed.includes(action.id)) return state;
      return {
        ...state,
        trashed: state.trashed.filter((id) => id !== action.id),
        restored: [action.id, ...state.restored],
        toast: true,
      };
    case "openBoard":
      return { ...state, view: "board", toast: false };
    case "openTrash":
      return { ...state, view: "trash", toast: false };
  }
}
