import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";

// Request schemas of the Triage Copilot routes (ai-triage/index.ts).

export const triageSuggestBody = z
  .strictObject({
    taskId: z.string().min(1).openapi({
      description:
        "The task to triage: a new or unlabelled task, or the task of an intake request.",
    }),
    locale: answerLocale,
  })
  .openapi("AiTriageSuggestInput");

export const triageProjectParam = z.object({
  projectId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "projectId", in: "path" },
      description: "Project ID",
    }),
});

export const updateTriageSettingsBody = z
  .strictObject({
    autoApplyLabels: z.boolean().openapi({
      description:
        "Apply suggested labels as soon as they are suggested (each application is audited). Off by default: people accept every suggestion.",
    }),
  })
  .openapi("AiTriageSettingsInput");

export const draftLabelsBody = z
  .strictObject({
    projectId: z.string().min(1).openapi({
      description: "The project the task is being created in.",
    }),
    title: z.string().trim().min(3).max(255).openapi({
      description: "The draft's title so far.",
    }),
    description: z.string().max(10_000).optional().openapi({
      description: "The draft's description so far, as Markdown.",
    }),
    labelIds: z.array(z.string().min(1)).max(50).optional().openapi({
      description: "Labels already picked in the form; never suggested again.",
    }),
    locale: answerLocale,
  })
  .openapi("AiDraftLabelsInput");
