export type StickyColor = "yellow" | "teal" | "purple";

export type Sticky = {
  id: string;
  color: StickyColor;
  text: string;
};

export type HomeState = {
  stickies: Sticky[];
  /** The sticky being edited. */
  editing: string | null;
  /** Autosave is pending for the edited sticky. */
  saving: boolean;
  /** Where the page is scrolled to. */
  reveal: "top" | "stickies";
};

export type HomeAction =
  | { type: "reveal"; to: HomeState["reveal"] }
  | { type: "addSticky" }
  | { type: "focus"; id: string }
  | { type: "input"; id: string; value: string }
  | { type: "blur" };

export const NEW_STICKY_ID = "new";

export function homeReducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case "reveal":
      return { ...state, reveal: action.to };
    case "addSticky": {
      // Like the app: a new yellow sticky goes first, focused and empty.
      if (state.stickies.some((sticky) => sticky.id === NEW_STICKY_ID)) {
        return { ...state, editing: NEW_STICKY_ID };
      }
      return {
        ...state,
        reveal: "stickies",
        editing: NEW_STICKY_ID,
        stickies: [
          { id: NEW_STICKY_ID, color: "yellow", text: "" },
          ...state.stickies,
        ],
      };
    }
    case "focus":
      return { ...state, editing: action.id };
    case "input":
      return {
        ...state,
        editing: action.id,
        saving: true,
        stickies: state.stickies.map((sticky) =>
          sticky.id === action.id ? { ...sticky, text: action.value } : sticky,
        ),
      };
    case "blur":
      return { ...state, editing: null, saving: false };
  }
}
