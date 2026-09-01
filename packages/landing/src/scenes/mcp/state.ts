export type McpTaskId = "announcement" | "pressKit" | "monitoring";

export const MCP_TASKS: readonly McpTaskId[] = [
  "announcement",
  "pressKit",
  "monitoring",
];

export type McpState = {
  input: string;
  focused: boolean;
  /** The prompt, once sent. */
  prompt: string | null;
  /** Tasks the agent has created through `create_task`, in order. */
  created: McpTaskId[];
  replied: boolean;
};

export type McpAction =
  | { type: "focus" }
  | { type: "input"; value: string }
  | { type: "send" }
  | { type: "create"; id: McpTaskId }
  | { type: "reply" };

export const initialMcpState: McpState = {
  input: "",
  focused: false,
  prompt: null,
  created: [],
  replied: false,
};

export function mcpReducer(state: McpState, action: McpAction): McpState {
  switch (action.type) {
    case "focus":
      return { ...state, focused: true };
    case "input":
      return { ...state, focused: true, input: action.value };
    case "send": {
      const prompt = state.input.trim();
      if (!prompt) return state;
      return {
        ...initialMcpState,
        focused: true,
        prompt,
      };
    }
    case "create":
      // The agent only acts on a prompt, and each task is created once.
      if (state.prompt === null || state.created.includes(action.id)) {
        return state;
      }
      return { ...state, created: [...state.created, action.id] };
    case "reply":
      if (state.prompt === null) return state;
      return { ...state, replied: true };
  }
}
