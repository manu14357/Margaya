export type PublicTaskId =
  | "sso"
  | "offline"
  | "commentHooks"
  | "export"
  | "search"
  | "darkMode";

export type PublicColumnId = "planned" | "inProgress" | "shipped";

export const PUBLIC_COLUMNS: readonly {
  id: PublicColumnId;
  tasks: readonly PublicTaskId[];
}[] = [
  { id: "planned", tasks: ["sso", "offline", "commentHooks"] },
  { id: "inProgress", tasks: ["export", "search"] },
  { id: "shipped", tasks: ["darkMode"] },
];

export type PublicBoardState = {
  /** Upvotes per task, the visitor's own included. */
  votes: Record<PublicTaskId, number>;
  /** The visitor's upvote. */
  mine: PublicTaskId | null;
  /** The task whose count just changed, for a short highlight. */
  bumped: PublicTaskId | null;
  peek: PublicTaskId | null;
  request: { open: boolean; title: string };
  /** Requests the visitor has sent (they wait for the team's review). */
  sent: number;
  toast: boolean;
};

export type PublicBoardAction =
  | { type: "remoteVote"; id: PublicTaskId }
  | { type: "open"; id: PublicTaskId }
  | { type: "close" }
  | { type: "upvote"; id: PublicTaskId }
  | { type: "openRequest" }
  | { type: "typeRequest"; value: string }
  | { type: "closeRequest" }
  | { type: "sendRequest" };

export const initialPublicBoardState: PublicBoardState = {
  votes: {
    sso: 41,
    offline: 37,
    commentHooks: 18,
    export: 52,
    search: 23,
    darkMode: 64,
  },
  mine: null,
  bumped: null,
  peek: null,
  request: { open: false, title: "" },
  sent: 0,
  toast: false,
};

export function publicBoardReducer(
  state: PublicBoardState,
  action: PublicBoardAction,
): PublicBoardState {
  switch (action.type) {
    case "remoteVote":
      return {
        ...state,
        votes: { ...state.votes, [action.id]: state.votes[action.id] + 1 },
        bumped: action.id,
      };
    case "open":
      return { ...state, peek: action.id, toast: false };
    case "close":
      return { ...state, peek: null };
    case "upvote": {
      // Clicking my vote again removes it; voting elsewhere moves it.
      const votes = { ...state.votes };
      if (state.mine) votes[state.mine] -= 1;
      if (state.mine === action.id) {
        return { ...state, votes, mine: null, bumped: null };
      }
      votes[action.id] += 1;
      return { ...state, votes, mine: action.id, bumped: action.id };
    }
    case "openRequest":
      return {
        ...state,
        peek: null,
        toast: false,
        request: { open: true, title: "" },
      };
    case "typeRequest":
      return { ...state, request: { open: true, title: action.value } };
    case "closeRequest":
      return { ...state, request: { open: false, title: "" } };
    case "sendRequest":
      if (!state.request.title.trim()) return state;
      return {
        ...state,
        request: { open: false, title: "" },
        sent: state.sent + 1,
        toast: true,
      };
  }
}
