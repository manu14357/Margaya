import { z } from "../openapi";
import { buildProposalSchema } from "./schema";

export const duplicateCheckSchema = z
  .object({
    tasks: z.array(
      z.object({
        id: z.string(),
        key: z.string().openapi({ description: "The task key (WEB-12)." }),
        title: z.string(),
        status: z.string(),
        verdict: z.enum(["duplicate", "related"]).openapi({
          description:
            "duplicate: likely the same work; related: overlapping work.",
        }),
        reason: z.string().openapi({
          description: "A short reason, in the caller's language.",
        }),
      }),
    ),
  })
  .openapi("AiDuplicateCheck", {
    description:
      "The full-text matches the model judged duplicate or related, most likely first. Tasks it judged different are left out.",
  });

export const buildProposalResponseSchema = z
  .object({
    proposal: buildProposalSchema,
    target: z
      .object({ projectId: z.string(), projectName: z.string() })
      .nullable()
      .openapi({
        description: "The project built into, or null for a new project.",
      }),
    model: z.string(),
  })
  .openapi("AiBuildProposalResult");

export const BUILD_ITEM_KINDS = [
  "project",
  "column",
  "cycle",
  "module",
  "task",
  "subtask",
  "label",
  "estimate",
  "cycle_tasks",
  "module_tasks",
] as const;

export const buildReportSchema = z
  .object({
    projectId: z.string().nullable().openapi({
      description:
        "The project built into; null when a new project could not be created.",
    }),
    total: z.number().int(),
    done: z.number().int(),
    created: z.object({
      project: z.boolean(),
      columns: z.number().int(),
      cycles: z.number().int(),
      modules: z.number().int(),
      tasks: z.number().int(),
      subtasks: z.number().int(),
      labels: z.number().int(),
    }),
    estimatesSkipped: z.boolean().openapi({
      description:
        "Estimates were left out: the project has no active points estimate system.",
    }),
    failures: z.array(
      z.object({
        kind: z.enum(BUILD_ITEM_KINDS),
        name: z.string(),
        status: z.number().int(),
        message: z.string(),
      }),
    ),
    undoToken: z.string().optional().openapi({
      description:
        "Pass to POST /ai/build/undo within an hour to revert the plan. Absent when nothing was created.",
    }),
  })
  .openapi("AiBuildReport", {
    description:
      "What was created. Each item went through the ordinary create route under the caller's permissions; failures are listed and the rest kept.",
  });

const UNDO_ITEM_KINDS = [
  "project",
  "column",
  "cycle",
  "module",
  "task",
  "subtask",
] as const;

export const buildUndoResultSchema = z
  .object({
    removed: z.object({
      project: z.boolean(),
      columns: z.number().int(),
      cycles: z.number().int(),
      modules: z.number().int(),
      tasks: z.number().int(),
      subtasks: z.number().int(),
    }),
    archived: z.number().int().openapi({
      description:
        "Items archived instead of deleted, because the caller may not delete them.",
    }),
    failures: z.array(
      z.object({
        kind: z.enum(UNDO_ITEM_KINDS),
        name: z.string(),
        status: z.number().int(),
        message: z.string(),
      }),
    ),
  })
  .openapi("AiBuildUndoResult", {
    description:
      "What was undone. Each item went through the ordinary delete route under the caller's permissions; failures are listed and the rest kept. Send the token again to retry them.",
  });

export const buildUndoRefusalSchema = z
  .object({
    code: z.enum(["BUILD_EDITED", "BUILD_ALREADY_UNDONE"]),
    message: z.string(),
    items: z
      .array(z.object({ kind: z.enum(UNDO_ITEM_KINDS), name: z.string() }))
      .openapi({ description: "The items that changed, up to ten." }),
    total: z.number().int().openapi({
      description: "How many items changed in all.",
    }),
  })
  .openapi("AiBuildUndoRefusal", {
    description: "Why nothing was undone. A refusal changes nothing.",
  });

export type BuildReport = z.infer<typeof buildReportSchema>;
export type BuildItemKind = (typeof BUILD_ITEM_KINDS)[number];
