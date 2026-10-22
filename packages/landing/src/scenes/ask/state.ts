export type AskMode = "ask" | "build";

/**
 * What a turn answers with. The demo knows two scripted prompts; anything
 * else the visitor types gets an honest canned reply.
 */
export type AskReply = "blockers" | "assign" | "generic";

/** A Build proposal's state once its plan is in. */
export type AskChange = "ready" | "applied" | "undone" | "cancelled";

export type AskTurn = {
  mode: AskMode;
  prompt: string;
  reply: AskReply;
  /** `reading`: dots; `thinking`: context open and a live timer; `done`. */
  phase: "reading" | "thinking" | "done";
  seconds: number;
  /** Build turns that propose a change; null otherwise. */
  change: AskChange | null;
};

export type AskState = {
  mode: AskMode;
  input: string;
  focused: boolean;
  turns: AskTurn[];
  /** WEB-5 is assigned to Mira on the board. */
  assigned: boolean;
  /** The board card's brief highlight after a confirmed change. */
  highlight: boolean;
};

export type AskAction =
  | { type: "focus" }
  | { type: "input"; value: string }
  | { type: "mode"; mode: AskMode }
  | { type: "send" }
  | { type: "read" }
  | { type: "tick" }
  | { type: "answer" }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "undo" }
  | { type: "settle" };

export const initialAskState: AskState = {
  mode: "ask",
  input: "",
  focused: false,
  turns: [],
  assigned: false,
  highlight: false,
};

function normalise(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s?.!]+$/, "");
}

/** The turn still on its way, if any. */
export function busyTurn(state: AskState): AskTurn | null {
  const last = state.turns[state.turns.length - 1];
  return last && last.phase !== "done" ? last : null;
}

function replaceAt(turns: AskTurn[], index: number, turn: AskTurn) {
  return turns.map((item, at) => (at === index ? turn : item));
}

function updateLast(
  state: AskState,
  update: (turn: AskTurn) => AskTurn | null,
): AskState {
  const index = state.turns.length - 1;
  const last = state.turns[index];
  const next = last ? update(last) : null;
  if (!next) return state;
  return { ...state, turns: replaceAt(state.turns, index, next) };
}

/** The reducer, given the two prompts the demo answers in full. */
export function createAskReducer(scripted: { ask: string; build: string }) {
  const replyTo = (mode: AskMode, prompt: string): AskReply => {
    const text = normalise(prompt);
    if (mode === "ask" && text === normalise(scripted.ask)) return "blockers";
    if (mode === "build" && text === normalise(scripted.build)) return "assign";
    return "generic";
  };

  return function askReducer(state: AskState, action: AskAction): AskState {
    switch (action.type) {
      case "focus":
        return { ...state, focused: true };
      case "input":
        return { ...state, focused: true, input: action.value };
      case "mode":
        return { ...state, mode: action.mode };
      case "send": {
        const prompt = state.input.trim();
        if (!prompt || busyTurn(state)) return state;
        // A new message leaves an unconfirmed proposal behind, unapplied.
        const turns = state.turns.map((turn) =>
          turn.change === "ready"
            ? { ...turn, change: "cancelled" as const }
            : turn,
        );
        const turn: AskTurn = {
          mode: state.mode,
          prompt,
          reply: replyTo(state.mode, prompt),
          phase: "reading",
          seconds: 0,
          change: null,
        };
        return { ...state, input: "", turns: [...turns, turn] };
      }
      case "read":
        return updateLast(state, (turn) =>
          turn.phase === "reading"
            ? { ...turn, phase: "thinking", seconds: 1 }
            : null,
        );
      case "tick":
        return updateLast(state, (turn) =>
          turn.phase === "thinking"
            ? { ...turn, seconds: turn.seconds + 1 }
            : null,
        );
      case "answer":
        return updateLast(state, (turn) =>
          turn.phase === "done"
            ? null
            : {
                ...turn,
                phase: "done",
                seconds: Math.max(1, turn.seconds),
                change: turn.reply === "assign" ? "ready" : null,
              },
        );
      case "confirm": {
        const next = updateLast(state, (turn) =>
          turn.change === "ready" ? { ...turn, change: "applied" } : null,
        );
        return next === state
          ? state
          : { ...next, assigned: true, highlight: true };
      }
      case "cancel":
        return updateLast(state, (turn) =>
          turn.change === "ready" ? { ...turn, change: "cancelled" } : null,
        );
      case "undo": {
        let index = state.turns.length - 1;
        while (index >= 0 && state.turns[index]?.change !== "applied") index--;
        const turn = state.turns[index];
        if (!turn) return state;
        return {
          ...state,
          turns: replaceAt(state.turns, index, { ...turn, change: "undone" }),
          assigned: false,
          highlight: false,
        };
      }
      case "settle":
        return state.highlight ? { ...state, highlight: false } : state;
    }
  };
}
