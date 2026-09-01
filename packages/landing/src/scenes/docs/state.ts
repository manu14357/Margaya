/** Where the visitor's text caret sits in the page. */
export type DocsFocus = "mine" | "slash" | "callout" | "depends" | null;

export type SlashCommandId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bulletList"
  | "taskList"
  | "quote"
  | "callout"
  | "codeBlock"
  | "divider";

export type SlashGroupId = "text" | "lists" | "insert";

/** The page editor's block menu, in the app's order and groups. */
export const SLASH_COMMANDS: readonly {
  id: SlashCommandId;
  group: SlashGroupId;
}[] = [
  { id: "paragraph", group: "text" },
  { id: "heading1", group: "text" },
  { id: "heading2", group: "text" },
  { id: "bulletList", group: "lists" },
  { id: "taskList", group: "lists" },
  { id: "quote", group: "insert" },
  { id: "callout", group: "insert" },
  { id: "codeBlock", group: "insert" },
  { id: "divider", group: "insert" },
];

export type DocsState = {
  /** Adam's paragraph, typed by the visitor's cursor. */
  mine: string;
  /** Mira's paragraph, typed by the collaborator. */
  collab: string;
  focus: DocsFocus;
  /** Mira's caret and name tag are showing. */
  collabActive: boolean;
  slash: { open: boolean; query: string };
  /** The inserted info callout's text; null until it is inserted. */
  callout: string | null;
  /** The pasted task link, now a chip. */
  chip: boolean;
  /** The chip's hover preview. */
  preview: boolean;
};

export type DocsAction =
  | { type: "focus"; at: DocsFocus }
  | { type: "typeMine"; value: string }
  | { type: "collabFocus" }
  | { type: "typeCollab"; value: string }
  /** The text of the slash line, including the leading "/". */
  | { type: "slash"; value: string }
  | { type: "pickSlash"; command: SlashCommandId }
  | { type: "typeCallout"; value: string }
  | { type: "paste" }
  | { type: "preview"; open: boolean };

/** The commands whose label (or id) contains the query, like the app's menu. */
export function filterSlash(
  query: string,
  labels: Record<SlashCommandId, string>,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (command) =>
      labels[command.id].toLowerCase().includes(needle) ||
      command.id.toLowerCase().includes(needle),
  );
}

export function docsReducer(state: DocsState, action: DocsAction): DocsState {
  switch (action.type) {
    case "focus":
      return {
        ...state,
        focus: action.at,
        slash: action.at === "slash" ? state.slash : { open: false, query: "" },
        preview: false,
      };
    case "typeMine":
      return { ...state, focus: "mine", mine: action.value };
    case "collabFocus":
      return { ...state, collabActive: true };
    case "typeCollab":
      return { ...state, collabActive: true, collab: action.value };
    case "slash": {
      const open = action.value.startsWith("/");
      return {
        ...state,
        focus: "slash",
        slash: { open, query: open ? action.value.slice(1) : "" },
      };
    }
    case "pickSlash":
      if (action.command !== "callout") {
        return { ...state, slash: { open: false, query: "" } };
      }
      return {
        ...state,
        slash: { open: false, query: "" },
        callout: state.callout ?? "",
        focus: "callout",
      };
    case "typeCallout":
      return { ...state, focus: "callout", callout: action.value };
    case "paste":
      return { ...state, chip: true, focus: "depends" };
    case "preview":
      return { ...state, preview: action.open && state.chip };
  }
}
