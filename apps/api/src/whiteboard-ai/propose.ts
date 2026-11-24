import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import db from "../database";
import type { BoardElement } from "../whiteboard/board";
import { currentBoardContent } from "../whiteboard/content";
import { assertCanEdit } from "../whiteboard/controllers/update-whiteboard";
import { loadWhiteboard, whiteboardCallerOf } from "../whiteboard/shared";
import { loadTaskCards } from "../whiteboard/task-cards";
import {
  BRAINSTORM_INSTRUCTIONS,
  BRAINSTORM_JSON_SCHEMA,
  boardLines,
  brainstormMessage,
  GROUP_INSTRUCTIONS,
  GROUP_JSON_SCHEMA,
  groupMessage,
  groupRefs,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_JSON_SCHEMA,
  summaryMessage,
} from "./prompt";
import { resolveGroups, resolveIdeas, resolveSummary } from "./resolve";
import {
  WHITEBOARD_AI_LIMITS as L,
  type WhiteboardBrainstormInput,
  type WhiteboardGroupInput,
  type WhiteboardSummarizeInput,
} from "./schema";

// Whiteboard AI: brainstorm notes, sort notes into themes, summarize the
// board. Each call reads the board as the caller (the route checked
// whiteboard access; here the project must be one AI may read) and returns
// a proposal. Nothing is written: the editor previews the proposal and, on
// accept, writes it like any manual edit (one undo step, synced live).

type BoardForAi = {
  elements: BoardElement[];
  projectId: string;
  readTasks: boolean;
  call: {
    workspaceId: string;
    userId: string;
    feature: "whiteboard";
    projectIds: string[];
    dataTier: ReturnType<typeof projectDataTier>;
  };
};

async function boardForAi(
  c: Context,
  whiteboardId: string,
  { edit }: { edit: boolean },
): Promise<BoardForAi> {
  const board = await loadWhiteboard(db, whiteboardId);
  // Proposals that change the board need a board the caller may edit now.
  if (edit) assertCanEdit(board, await whiteboardCallerOf(c));
  const scope = await resolveAiScope(c);
  // 404 for a hidden project, AI_DISABLED when its AI is off or restricted.
  assertProjectInScope(scope, board.projectId);
  const content = await currentBoardContent(board);
  return {
    elements: content.elements,
    projectId: board.projectId,
    readTasks: scope.can.readTasks,
    call: {
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      feature: "whiteboard",
      projectIds: [board.projectId],
      dataTier: projectDataTier(scope, board.projectId),
    },
  };
}

async function system(
  instructions: string,
  locale: string | undefined,
  userId: string,
) {
  return buildSystemPrompt({
    instructions,
    locale: locale ?? (await userLocale(userId)),
  });
}

/** POST /ai/whiteboard/{id}/brainstorm */
export async function proposeBrainstorm(
  c: Context,
  whiteboardId: string,
  input: WhiteboardBrainstormInput,
) {
  const board = await boardForAi(c, whiteboardId, { edit: true });
  const count = input.count ?? L.ideasDefault;
  const { value } = await aiCompleteJson<unknown>({
    ...board.call,
    tier: "fast",
    system: await system(
      BRAINSTORM_INSTRUCTIONS,
      input.locale,
      board.call.userId,
    ),
    messages: [
      {
        role: "user",
        content: brainstormMessage({
          prompt: input.prompt,
          count,
          // Task cards stay out: ideas only need the notes around them.
          boardText: boardLines(board.elements).join("\n"),
        }),
      },
    ],
    jsonSchema: BRAINSTORM_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 300 + count * 60,
    effort: "low",
  });
  return resolveIdeas(value, count);
}

/** POST /ai/whiteboard/{id}/group */
export async function proposeGroups(
  c: Context,
  whiteboardId: string,
  input: WhiteboardGroupInput,
) {
  const board = await boardForAi(c, whiteboardId, { edit: true });
  const wanted = new Set(input.elementIds);
  const notes = board.elements.filter(
    (element) =>
      wanted.has(element.id) &&
      element.type === "sticky" &&
      !element.locked &&
      element.text.trim().length > 0,
  );
  if (notes.length < 2) {
    throw new HTTPException(400, {
      message: "Select at least two unlocked notes with text",
    });
  }
  const refs = groupRefs(notes.map((note) => note.id));
  const byId = new Map(notes.map((note) => [note.id, note]));
  const { value } = await aiCompleteJson<unknown>({
    ...board.call,
    tier: "balanced",
    system: await system(GROUP_INSTRUCTIONS, input.locale, board.call.userId),
    messages: [
      {
        role: "user",
        content: groupMessage(
          [...refs].map(([ref, id]) => {
            const note = byId.get(id);
            return { ref, text: note?.type === "sticky" ? note.text : "" };
          }),
        ),
      },
    ],
    jsonSchema: GROUP_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 400 + notes.length * 20,
    effort: "low",
  });
  return resolveGroups(value, refs);
}

/** The selected elements, with the contents of selected frames. */
function selectionOf(
  elements: readonly BoardElement[],
  ids: readonly string[] | undefined,
): BoardElement[] {
  if (!ids || ids.length === 0) return [...elements];
  const wanted = new Set(ids);
  const frames = new Set(
    elements
      .filter((element) => element.type === "frame" && wanted.has(element.id))
      .map((element) => element.id),
  );
  return elements.filter(
    (element) =>
      wanted.has(element.id) ||
      (element.frameId !== null && frames.has(element.frameId)),
  );
}

/** POST /ai/whiteboard/{id}/summarize */
export async function proposeSummary(
  c: Context,
  whiteboardId: string,
  input: WhiteboardSummarizeInput,
) {
  const board = await boardForAi(c, whiteboardId, { edit: false });
  const selected = selectionOf(board.elements, input.elementIds);
  // Task titles are task data: only for callers who may read tasks.
  const taskIds = board.readTasks
    ? selected.flatMap((element) =>
        element.type === "task" && element.taskId ? [element.taskId] : [],
      )
    : [];
  const tasks =
    taskIds.length > 0 ? await loadTaskCards(board.projectId, taskIds) : {};
  const lines = boardLines(selected, tasks);
  if (lines.length === 0) {
    throw new HTTPException(400, {
      message: "There is no text to summarize",
    });
  }
  const { value } = await aiCompleteJson<unknown>({
    ...board.call,
    tier: "fast",
    system: await system(SUMMARY_INSTRUCTIONS, input.locale, board.call.userId),
    messages: [
      {
        role: "user",
        content: summaryMessage({
          lines,
          selection: Boolean(input.elementIds?.length),
        }),
      },
    ],
    jsonSchema: SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1000,
    effort: "low",
  });
  return resolveSummary(value, lines.length);
}
