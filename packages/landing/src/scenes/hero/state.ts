import type { LabelColor, Priority, StatusId } from "../../replica";

export type HeroStatus = Extract<StatusId, "todo" | "inProgress" | "done">;

export type HeroTask = {
  id: string;
  number: number;
  title: string;
  status: HeroStatus;
  priority: Priority;
  labels: { name: string; color: LabelColor }[];
  assignees: string[];
};

export type HeroState = {
  tasks: HeroTask[];
  capture: { active: boolean; text: string };
  openTaskId: string | null;
};

export type HeroAction =
  | { type: "focus" }
  | { type: "input"; value: string }
  | { type: "submit" }
  | { type: "move"; id: string; status: HeroStatus }
  | { type: "open"; id: string }
  | { type: "close" };

export type CaptureToken =
  | { kind: "assignee"; raw: string; name: string }
  | { kind: "priority"; raw: string; priority: Priority }
  | { kind: "label"; raw: string; name: string; color: LabelColor };

/** What the parser can match: from `landing.demo`, so it translates. */
export type CaptureVocabulary = {
  people: readonly { handle: string; name: string }[];
  /** Priority words (ids and translated labels), lower case. */
  priorities: readonly { word: string; priority: Priority }[];
  labels: readonly { name: string; color: LabelColor }[];
};

/**
 * A miniature of the app's capture parser: `@person`, `!priority` and
 * `#label` become tokens, the rest stays the title. A token counts once it
 * matches (a label matches as soon as one character follows `#`).
 */
export function parseCapture(
  text: string,
  vocabulary: CaptureVocabulary,
): { title: string; tokens: CaptureToken[] } {
  const tokens: CaptureToken[] = [];
  const words = text.split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    const sigil = word[0];
    const body = word.slice(1).toLowerCase();
    let token: CaptureToken | null = null;
    if (sigil === "@" && body) {
      const person = vocabulary.people.find(
        (candidate) => candidate.handle.toLowerCase() === body,
      );
      if (person) token = { kind: "assignee", raw: word, name: person.name };
    } else if (sigil === "!" && body) {
      const match = vocabulary.priorities.find(
        (candidate) => candidate.word === body,
      );
      if (match) {
        token = { kind: "priority", raw: word, priority: match.priority };
      }
    } else if (sigil === "#" && body) {
      const known = vocabulary.labels.find(
        (label) => label.name.toLowerCase() === body,
      );
      token = {
        kind: "label",
        raw: word,
        name: known?.name ?? word.slice(1),
        color: known?.color ?? "gray",
      };
    }
    if (token) tokens.push(token);
    else if (word) kept.push(word);
  }
  return { title: kept.join(" "), tokens };
}

export const NEW_TASK_ID = "new";

/** Moves a task to the top of a column. */
function moveTask(tasks: HeroTask[], id: string, status: HeroStatus) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return tasks;
  const rest = tasks.filter((candidate) => candidate.id !== id);
  const index = rest.findIndex((candidate) => candidate.status === status);
  const moved = { ...task, status };
  if (index === -1) return [...rest, moved];
  return [...rest.slice(0, index), moved, ...rest.slice(index)];
}

export function createHeroReducer(
  vocabulary: CaptureVocabulary,
  nextNumber: number,
) {
  return (state: HeroState, action: HeroAction): HeroState => {
    switch (action.type) {
      case "focus":
        return { ...state, capture: { ...state.capture, active: true } };
      case "input":
        return { ...state, capture: { active: true, text: action.value } };
      case "submit": {
        const { title, tokens } = parseCapture(state.capture.text, vocabulary);
        if (!title) return state;
        const task: HeroTask = {
          id: NEW_TASK_ID,
          number: nextNumber,
          title,
          status: "todo",
          priority:
            tokens.find((token) => token.kind === "priority")?.priority ??
            "none",
          labels: tokens.flatMap((token) =>
            token.kind === "label"
              ? [{ name: token.name, color: token.color }]
              : [],
          ),
          assignees: tokens.flatMap((token) =>
            token.kind === "assignee" ? [token.name] : [],
          ),
        };
        return {
          ...state,
          tasks: [
            ...state.tasks.filter((existing) => existing.id !== NEW_TASK_ID),
            task,
          ],
          // Like the app, the bar stays ready for the next task.
          capture: { active: true, text: "" },
        };
      }
      case "move":
        return {
          ...state,
          tasks: moveTask(state.tasks, action.id, action.status),
          capture: { ...state.capture, active: false },
        };
      case "open":
        return {
          ...state,
          openTaskId: action.id,
          capture: { ...state.capture, active: false },
        };
      case "close":
        return { ...state, openTaskId: null };
    }
  };
}
