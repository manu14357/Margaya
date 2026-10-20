import { z } from "../openapi";
import {
  ASK_ATTACHMENT_TYPES,
  MAX_ASK_ATTACHMENT_BYTES,
  MAX_ASK_ATTACHMENTS,
} from "./attachments";

// Request schema of Ask (ai-ask/index.ts). Follow-ups are kept by the
// client only: it sends the session's earlier turns back with each question.

export const MAX_ASK_QUESTION_CHARS = 2_000;
export const MAX_ASK_HISTORY_TURNS = 6;
export const MAX_ASK_HISTORY_ANSWER_CHARS = 8_000;
export const MAX_ASK_CONTEXT_ITEMS = 10;
/** Base64 grows data by a third; the rest of the body stays small. */
export const MAX_ASK_BODY_BYTES =
  Math.ceil((MAX_ASK_ATTACHMENT_BYTES * 4) / 3) + 160 * 1024;

export const ASK_CONTEXT_KINDS = [
  "task",
  "page",
  "project",
  "cycle",
  "module",
  "user",
  "agent",
] as const;

const askTurnSchema = z
  .object({
    question: z.string().min(1).max(MAX_ASK_QUESTION_CHARS),
    answer: z.string().max(MAX_ASK_HISTORY_ANSWER_CHARS),
  })
  .strict()
  .openapi("AskTurn");

const askContextSchema = z
  .object({
    kind: z.enum(ASK_CONTEXT_KINDS),
    id: z.string().min(1).max(128),
  })
  .strict()
  .openapi("AskContextItem", {
    description:
      'Something the person pointed at with "@": loaded fresh and first. Tasks and pages are cited as usual; a project brings its live counts, a cycle or module its tasks and counts, a person or agent their open assigned tasks. Unknown or invisible ids are skipped.',
  });

const askAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mediaType: z
      .string()
      .min(1)
      .max(100)
      .openapi({
        description: `One of ${ASK_ATTACHMENT_TYPES.join(", ")}. Images go to the model as images (metadata stripped; needs a vision model), text files as context.`,
      }),
    data: z.string().min(1).openapi({ description: "The file, base64." }),
  })
  .strict()
  .openapi("AskAttachment");

export const askBodySchema = z
  .object({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    question: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ASK_QUESTION_CHARS)
      .openapi({ description: "The question, in any language." }),
    projectId: z.string().min(1).max(128).optional().openapi({
      description:
        "Answer from this project only (Ask opened inside a project). 404 when the caller can't see it; AI_DISABLED when AI may not read it.",
    }),
    history: z
      .array(askTurnSchema)
      .max(MAX_ASK_HISTORY_TURNS)
      .optional()
      .openapi({
        description:
          "Earlier questions and answers of this session, oldest first, for follow-up questions. Never stored on the server.",
      }),
    locale: z
      .string()
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .max(16)
      .optional()
      .openapi({
        description:
          "The UI language to answer in (e.g. de-DE). Defaults to the caller's saved locale.",
      }),
    context: z
      .array(askContextSchema)
      .max(MAX_ASK_CONTEXT_ITEMS)
      .optional()
      .openapi({
        description: `Up to ${MAX_ASK_CONTEXT_ITEMS} items the question is about ("@" mentions), put first in the context.`,
      }),
    webSearch: z.boolean().optional().openapi({
      description:
        "Also search the web for this question (only the question is sent to the search provider). 403 AI_DISABLED unless the instance has a search provider and the workspace turned web search on. Results are cited as [W:n].",
    }),
    attachments: z
      .array(askAttachmentSchema)
      .max(MAX_ASK_ATTACHMENTS)
      .optional()
      .openapi({
        description: `Up to ${MAX_ASK_ATTACHMENTS} files, at most 5 MB together: PNG, JPEG, WebP or GIF images, or text, Markdown or CSV files. Never stored.`,
      }),
    skillId: z.string().min(1).max(128).optional().openapi({
      description:
        "A saved skill (GET /ai/skills) whose prompt is added as the person's instructions for this question. 404 when the caller can't use it.",
    }),
  })
  .strict()
  .openapi("AskRequest");

export type AskBody = z.infer<typeof askBodySchema>;
export type AskContextRef = z.infer<typeof askContextSchema>;
