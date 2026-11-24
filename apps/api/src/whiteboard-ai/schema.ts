import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";

// Request schemas of the whiteboard AI routes. The routes only propose:
// nothing on the board changes until the person accepts in the editor,
// which writes through the board's own realtime document.

export const WHITEBOARD_AI_LIMITS = {
  promptLength: 500,
  ideasDefault: 8,
  ideasMin: 3,
  ideasMax: 20,
  ideaLength: 140,
  titleLength: 80,
  /** Notes one "group" request may sort. */
  groupNotesMax: 60,
  groupNoteLength: 300,
  groupsMax: 8,
  groupTitleLength: 60,
  /** Elements one "summarize" request may name. */
  selectionMax: 1000,
  summaryLength: 1500,
  /** Board text sent with a request (longer text is cut, visibly). */
  boardChars: 12_000,
} as const;

const elementId = z.string().min(1).max(64);

export const whiteboardBrainstormBody = z
  .strictObject({
    prompt: z
      .string()
      .trim()
      .min(2)
      .max(WHITEBOARD_AI_LIMITS.promptLength)
      .openapi({
        description:
          'What to brainstorm, in the caller\'s words, e.g. "ways to cut onboarding time".',
      }),
    count: z
      .number()
      .int()
      .min(WHITEBOARD_AI_LIMITS.ideasMin)
      .max(WHITEBOARD_AI_LIMITS.ideasMax)
      .optional()
      .openapi({
        description: `How many ideas to propose (${WHITEBOARD_AI_LIMITS.ideasMin} to ${WHITEBOARD_AI_LIMITS.ideasMax}, default ${WHITEBOARD_AI_LIMITS.ideasDefault}).`,
      }),
    locale: answerLocale,
  })
  .openapi("WhiteboardAiBrainstormInput");

export const whiteboardGroupBody = z
  .strictObject({
    elementIds: z
      .array(elementId)
      .min(2)
      .max(WHITEBOARD_AI_LIMITS.groupNotesMax)
      .openapi({
        description: `The sticky notes to sort into themes (2 to ${WHITEBOARD_AI_LIMITS.groupNotesMax}). Other elements and notes without text are ignored.`,
      }),
    locale: answerLocale,
  })
  .openapi("WhiteboardAiGroupInput");

export const whiteboardSummarizeBody = z
  .strictObject({
    elementIds: z
      .array(elementId)
      .max(WHITEBOARD_AI_LIMITS.selectionMax)
      .optional()
      .openapi({
        description:
          "Summarize only these elements (a selected frame brings its contents). Without it, or empty, the whole board.",
      }),
    locale: answerLocale,
  })
  .openapi("WhiteboardAiSummarizeInput");

export type WhiteboardBrainstormInput = z.infer<
  typeof whiteboardBrainstormBody
>;
export type WhiteboardGroupInput = z.infer<typeof whiteboardGroupBody>;
export type WhiteboardSummarizeInput = z.infer<typeof whiteboardSummarizeBody>;
