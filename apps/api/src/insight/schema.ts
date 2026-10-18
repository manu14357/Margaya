import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";

// Request schemas of the planning insight routes (insight/index.ts and
// insight/ai.ts): calibrated estimates, capacity, retrospectives, My brief.

export const projectIdParam = z.object({
  projectId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "projectId", in: "path" },
      description: "Project ID",
    }),
});

export const cycleIdParam = z.object({
  cycleId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "cycleId", in: "path" },
      description: "Cycle ID",
    }),
});

const subjectTitle = z.string().trim().min(1).max(500).optional().openapi({
  description:
    "The title to match when the task does not exist yet (or to override its title).",
});

export const suggestionQuery = z
  .object({
    taskId: z.string().min(1).optional().openapi({
      description:
        "The task being estimated (its title and labels are matched).",
    }),
    title: subjectTitle,
  })
  .refine((value) => Boolean(value.taskId || value.title), {
    message: "Send taskId or title",
  });

export const workspaceIdQuery = z.object({
  workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
});

export const estimateExplainBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    projectId: z.string().min(1).openapi({ description: "Project ID" }),
    taskId: z.string().min(1).optional().openapi({
      description: "The task being estimated.",
    }),
    title: subjectTitle,
    locale: answerLocale,
  })
  .refine((value) => Boolean(value.taskId || value.title), {
    message: "Send taskId or title",
  })
  .openapi("AiEstimateExplainInput");

export const retroNarrativeBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    cycleId: z.string().min(1).openapi({ description: "Cycle ID" }),
    locale: answerLocale,
  })
  .openapi("AiRetroInput");

export const inboxDigestBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    locale: answerLocale,
  })
  .openapi("AiInboxDigestInput");

export const myBriefSummaryBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    locale: answerLocale,
  })
  .openapi("AiMyBriefInput");
