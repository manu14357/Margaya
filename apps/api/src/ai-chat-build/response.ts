import { z } from "../openapi";
import { actionSchema } from "./schema";

// Response schemas of the chat Build routes (ai-chat-build/index.ts).

export const actionResultSchema = z
  .object({
    actionId: z.string(),
    ok: z.boolean(),
    url: z.string().optional().openapi({
      description: "App path of what was created or changed.",
    }),
    label: z.string().optional().openapi({
      description: 'A short name of it, e.g. "NX-12 Calibrate IMU".',
    }),
    error: z.string().optional().openapi({
      description:
        "Why it failed, or (with ok) what part of it didn't go through.",
    }),
    skipped: z.boolean().optional().openapi({
      description:
        "Not attempted: it had a problem, an action it depends on failed, or it is destructive and was not confirmed.",
    }),
    undoToken: z.string().optional().openapi({
      description:
        "Pass to POST /ai/chat/undo within an hour to revert this action.",
    }),
    runId: z.string().optional().openapi({
      description: "For run_agent: the queued agent run.",
    }),
  })
  .openapi("ChatBuildActionResult");

export const applyResponseSchema = z
  .object({ results: z.array(actionResultSchema) })
  .openapi("ChatBuildApplyResult");

export const planResponseSchema = z
  .object({
    status: z.enum(["proposal", "question", "nothing"]).openapi({
      description:
        "proposal: review the actions; question: answer it (pick an option) and plan again; nothing: no change fits the request.",
    }),
    summary: z.string(),
    actions: z.array(actionSchema),
    question: z
      .object({ text: z.string(), options: z.array(z.string()) })
      .optional(),
    truncated: z.boolean().openapi({
      description: "The model proposed more actions than a plan may hold.",
    }),
    autopilot: z
      .object({
        applied: z.boolean(),
        reason: z.enum(["AUTOPILOT_OFF", "NEEDS_REVIEW"]).optional().openapi({
          description:
            "Why it was not applied: the workspace doesn't allow Autopilot, or the plan has problems, a destructive action or a question.",
        }),
      })
      .optional()
      .openapi({ description: "Only when the request asked for Autopilot." }),
    results: z.array(actionResultSchema).optional().openapi({
      description: "When Autopilot applied the plan.",
    }),
    model: z.string(),
    reasoningMs: z.number().int().nullable().openapi({
      description:
        "How long the model thought before answering; null when it streamed no reasoning.",
    }),
  })
  .openapi("ChatBuildPlan");

export const undoResponseSchema = z
  .object({ ok: z.literal(true) })
  .openapi("ChatBuildUndoResult");
