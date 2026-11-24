import { wrapUntrusted } from "../ai/prompt";
import type { BoardElement, TaskCardData } from "../whiteboard/board";
import { sortByOrder } from "../whiteboard/board";
import { WHITEBOARD_AI_LIMITS as L } from "./schema";

// Instructions, answer schemas and request text of the whiteboard AI
// features. Board text is workspace content: it only ever reaches the model
// inside <untrusted> blocks.

export const BRAINSTORM_INSTRUCTIONS = `You help a team brainstorm on a whiteboard.
Propose sticky-note ideas for the topic in the request.
- Each idea is one short phrase or sentence (at most 12 words), concrete, and different from the other ideas and from the notes already on the board.
- Give the number of ideas asked for, or fewer when the topic is too narrow.
- Also give a short title (at most 6 words) that names the set of ideas.
- Plain text only: no numbering, emoji, quotes or Markdown.`;

export const GROUP_INSTRUCTIONS = `You sort whiteboard sticky notes into themes.
The request lists the notes one per line as "ref: text".
- Make 2 to ${L.groupsMax} themes, each with a short title (at most 5 words) that names what its notes share.
- Put every note in exactly one theme, by its ref. Never invent refs.
- A note that fits no theme goes into the closest one.`;

export const SUMMARY_INSTRUCTIONS = `You summarize what is on a whiteboard.
The request holds the board's text (notes, shapes, frames, task cards), one element per line.
- Give a short title (at most 8 words) and a summary of at most 6 short lines, each starting with "- ".
- Cover the main themes, decisions and open questions. Use only what is on the board.
- Plain text only: no headings, bold or links.`;

export const BRAINSTORM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "ideas"],
  properties: {
    title: { type: "string" },
    ideas: { type: "array", items: { type: "string" } },
  },
} as const;

export const GROUP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "refs"],
        properties: {
          title: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
  },
} as const;

/** Collapses whitespace so one element is one line. */
export function oneLine(text: string, maxChars: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

/**
 * The readable lines of elements, bottom to top. Task cards show their key
 * and title only when `tasks` resolves them (the caller may read tasks).
 */
export function boardLines(
  elements: readonly BoardElement[],
  tasks: Readonly<Record<string, TaskCardData>> = {},
): string[] {
  const lines: string[] = [];
  for (const element of sortByOrder(elements)) {
    if (element.deleted) continue;
    let line = "";
    switch (element.type) {
      case "frame":
        line = element.name.trim()
          ? `Frame: ${oneLine(element.name, 200)}`
          : "";
        break;
      case "task": {
        const card = tasks[element.taskId];
        line = card ? `Task ${card.key}: ${oneLine(card.title, 300)}` : "";
        break;
      }
      case "draw":
      case "image":
        break;
      default:
        line = oneLine(element.text, 1000);
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function brainstormMessage(input: {
  prompt: string;
  count: number;
  boardText: string;
}): string {
  return [
    "The topic to brainstorm:",
    wrapUntrusted({ source: "request", text: input.prompt, maxChars: 1000 }),
    `Number of ideas: ${input.count}.`,
    input.boardText
      ? `What is already on the board (don't repeat it):\n${wrapUntrusted({
          source: "whiteboard",
          text: input.boardText,
          maxChars: L.boardChars,
        })}`
      : "The board is empty.",
    "Return the title and ideas as JSON.",
  ].join("\n\n");
}

/** Notes are named by short refs (n1, n2, ...): ids never reach the model. */
export function groupRefs(ids: readonly string[]): Map<string, string> {
  return new Map(ids.map((id, index) => [`n${index + 1}`, id]));
}

export function groupMessage(
  notes: readonly { ref: string; text: string }[],
): string {
  const lines = notes
    .map((note) => `${note.ref}: ${oneLine(note.text, L.groupNoteLength)}`)
    .join("\n");
  return [
    "The notes to sort:",
    wrapUntrusted({ source: "whiteboard", text: lines, maxChars: 30_000 }),
    "Return the themes as JSON.",
  ].join("\n\n");
}

export function summaryMessage(input: {
  lines: readonly string[];
  selection: boolean;
}): string {
  return [
    input.selection ? "The selected part of the board:" : "The whole board:",
    wrapUntrusted({
      source: "whiteboard",
      text: input.lines.join("\n"),
      maxChars: L.boardChars,
    }),
    "Return the title and summary as JSON.",
  ].join("\n\n");
}
