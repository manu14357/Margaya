import type { StatusId } from "../../replica";

export type JiraStatusId = "open" | "inProgress" | "review" | "done";

export const JIRA_STATUSES: readonly JiraStatusId[] = [
  "open",
  "inProgress",
  "review",
  "done",
];

export const COLUMNS: readonly StatusId[] = [
  "backlog",
  "todo",
  "inProgress",
  "inReview",
  "done",
];

export type JiraStep = "upload" | "map" | "importing" | "done";

export type JiraState = {
  step: JiraStep;
  /** The CSV export has been dropped in. */
  file: boolean;
  /** Jira status → Margaya column. */
  mapping: Record<JiraStatusId, StatusId>;
  /** The column picker that is open, if any. */
  picking: JiraStatusId | null;
};

export type JiraAction =
  | { type: "drop" }
  | { type: "next" }
  | { type: "back" }
  | { type: "pick"; id: JiraStatusId }
  | { type: "map"; id: JiraStatusId; column: StatusId }
  | { type: "import" }
  | { type: "finish" }
  | { type: "reset" };

/** The first guess, by name, like the app's: Code Review lands In progress. */
export const initialJiraState: JiraState = {
  step: "upload",
  file: false,
  mapping: {
    open: "todo",
    inProgress: "inProgress",
    review: "inProgress",
    done: "done",
  },
  picking: null,
};

export function jiraReducer(state: JiraState, action: JiraAction): JiraState {
  switch (action.type) {
    case "drop":
      return state.step === "upload" ? { ...state, file: true } : state;
    case "next":
      return state.step === "upload" && state.file
        ? { ...state, step: "map" }
        : state;
    case "back":
      return state.step === "map"
        ? { ...state, step: "upload", picking: null }
        : state;
    case "pick":
      return state.step === "map"
        ? { ...state, picking: state.picking === action.id ? null : action.id }
        : state;
    case "map":
      if (state.step !== "map") return state;
      return {
        ...state,
        mapping: { ...state.mapping, [action.id]: action.column },
        picking: null,
      };
    case "import":
      return state.step === "map"
        ? { ...state, step: "importing", picking: null }
        : state;
    case "finish":
      return state.step === "importing" ? { ...state, step: "done" } : state;
    case "reset":
      return initialJiraState;
  }
}
