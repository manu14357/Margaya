import type { StatusId } from "../../replica";

export const STATUS_ORDER: StatusId[] = [
  "backlog",
  "todo",
  "inProgress",
  "inReview",
  "done",
];

export type PalettePhase = "closed" | "palette" | "picker";

export type PaletteState = {
  phase: PalettePhase;
  query: string;
  /** The highlighted row of the status picker. */
  pickerIndex: number;
  /** The open task's status. */
  status: StatusId;
  toast: boolean;
};

export type PaletteAction =
  | { type: "open" }
  | { type: "input"; value: string }
  /** Runs "Change status…": the palette closes and the picker opens. */
  | { type: "run" }
  | { type: "move"; delta: number }
  /** Applies the highlighted status, or the one given. */
  | { type: "apply"; status?: StatusId }
  | { type: "close" };

export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
): PaletteState {
  switch (action.type) {
    case "open":
      return { ...state, phase: "palette", query: "", toast: false };
    case "input":
      return { ...state, query: action.value };
    case "run":
      return {
        ...state,
        phase: "picker",
        query: "",
        pickerIndex: Math.max(0, STATUS_ORDER.indexOf(state.status)),
      };
    case "move": {
      const count = STATUS_ORDER.length;
      return {
        ...state,
        pickerIndex: (state.pickerIndex + action.delta + count) % count,
      };
    }
    case "apply":
      return {
        ...state,
        phase: "closed",
        status:
          action.status ?? STATUS_ORDER[state.pickerIndex] ?? state.status,
        toast: true,
      };
    case "close":
      return { ...state, phase: "closed" };
  }
}

export type PaletteGroupId = "thisTask" | "suggestions" | "commands";

export type PaletteItem = {
  id: string;
  label: string;
  /** Keys shown at the end of the row, e.g. "S". */
  shortcut?: string;
};

export type PaletteGroup = { id: PaletteGroupId; items: PaletteItem[] };

/** `>` narrows the bar to actions, like the app's palette-query. */
export function parseQuery(query: string): {
  mode: "all" | "actions";
  term: string;
} {
  const trimmed = query.trimStart();
  if (trimmed.startsWith(">")) {
    return { mode: "actions", term: trimmed.slice(1).trim() };
  }
  return { mode: "all", term: trimmed.trim() };
}

/** Every word of the term appears in the label, ignoring case. */
export function matchesTerm(term: string, label: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = label.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The rows the bar shows for a query: the open task's commands first, then
 * suggestions (plain query) or commands (`>` or a search term).
 */
export function paletteGroups(
  query: string,
  groups: Record<PaletteGroupId, PaletteItem[]>,
): PaletteGroup[] {
  const { mode, term } = parseQuery(query);
  const ids: PaletteGroupId[] =
    mode === "actions"
      ? ["thisTask", "commands"]
      : term
        ? ["thisTask", "suggestions", "commands"]
        : ["thisTask", "suggestions"];
  return ids
    .map((id) => ({
      id,
      items: groups[id].filter((item) => matchesTerm(term, item.label)),
    }))
    .filter((group) => group.items.length > 0);
}
