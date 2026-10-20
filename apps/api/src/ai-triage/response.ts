import { z } from "../openapi";
import { VALID_PRIORITIES } from "../task/validate-task-fields";

// Response schemas of the Triage Copilot routes (ai-triage/index.ts).

const reason = z.string().nullable().openapi({
  description:
    "One line on why, in the caller's language. Null for a duplicate found by an exact title match only.",
});

export const triageSuggestionsSchema = z
  .object({
    taskId: z.string(),
    kind: z.enum(["intake", "task"]).openapi({
      description: "intake for an open intake request, task otherwise.",
    }),
    labels: z.array(
      z.object({
        labelId: z.string().openapi({
          description: "The workspace label to attach (PUT /label/{id}/task).",
        }),
        name: z.string(),
        color: z.string(),
        reason,
        applied: z.boolean().openapi({
          description:
            "Already attached because the project auto-applies label suggestions.",
        }),
      }),
    ),
    assignee: z
      .object({
        userId: z.string(),
        name: z.string(),
        image: z.string().nullable(),
        reason,
      })
      .nullable(),
    priority: z.object({ value: z.enum(VALID_PRIORITIES), reason }).nullable(),
    project: z
      .object({
        projectId: z.string(),
        name: z.string(),
        slug: z.string(),
        reason,
      })
      .nullable()
      .openapi({
        description:
          "A better-fitting project. Intake requests can't move: it is advice there.",
      }),
    duplicates: z.array(
      z.object({
        taskId: z.string(),
        projectId: z.string(),
        key: z.string(),
        title: z.string(),
        status: z.string().nullable(),
        reason,
      }),
    ),
    autoApplied: z.boolean().openapi({
      description: "Some labels were applied by the project's auto-apply.",
    }),
  })
  .openapi("AiTriageSuggestions");

export const triageSettingsSchema = z
  .object({
    projectId: z.string(),
    autoApplyLabels: z.boolean(),
  })
  .openapi("AiTriageSettings");

export const draftLabelSuggestionsSchema = z
  .object({
    labels: z.array(
      z.object({
        labelId: z.string().openapi({
          description: "A workspace label to add to the new task.",
        }),
        name: z.string(),
        color: z.string(),
        reason,
      }),
    ),
  })
  .openapi("AiDraftLabelSuggestions");
