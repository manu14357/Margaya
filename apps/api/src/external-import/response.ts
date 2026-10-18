import { MARGAYA_PRIORITIES } from "../jira-import/mapping";
import { z } from "../openapi";
import { EXTERNAL_SOURCES } from "./types";

const countedName = z.object({ name: z.string(), count: z.number() });

const warningSchema = z
  .object({
    message: z.string(),
    count: z.number().openapi({ description: "How many items it affects." }),
  })
  .openapi("ExternalImportWarning");

export const externalPreviewSchema = z
  .object({
    source: z.enum(EXTERNAL_SOURCES),
    itemCount: z.number().openapi({ description: "Items the import reads." }),
    columns: z.array(countedName).openapi({
      description:
        "Detected CSV columns, or the Trello lists cards are on, with counts.",
    }),
    statuses: z.array(
      z.object({
        name: z.string(),
        category: z.string().nullable(),
        count: z.number(),
        suggestedStatus: z.string().openapi({
          description: "Column slug, or `planned` for the backlog.",
        }),
      }),
    ),
    priorities: z.array(
      z.object({
        name: z.string(),
        count: z.number(),
        suggestedPriority: z.enum(MARGAYA_PRIORITIES),
      }),
    ),
    people: z.array(
      z.object({
        name: z.string().openapi({ description: "As the export writes it." }),
        count: z.number(),
        member: z
          .object({ id: z.string(), name: z.string() })
          .nullable()
          .openapi({
            description:
              "The workspace member matched by email (or unique name), or null: their items stay unassigned with a note.",
          }),
      }),
    ),
    totals: z.object({
      comments: z.number(),
      checklists: z.number(),
      subtasks: z.number(),
      links: z.number(),
      alreadyImported: z.number().openapi({
        description: "Items imported into this project before.",
      }),
    }),
    permissions: z.object({ update: z.boolean(), comments: z.boolean() }),
    warnings: z.array(warningSchema),
  })
  .openapi("ExternalImportPreview");

export const externalImportResultSchema = z
  .object({
    total: z.number(),
    created: z.number(),
    updated: z.number(),
    skipped: z.number().openapi({
      description: "Items imported before and left as they are.",
    }),
    failed: z.number(),
    comments: z.number().openapi({ description: "Comments added." }),
    relations: z.number().openapi({
      description: "Sub-task, blocking and related relations added.",
    }),
    unmatchedPeople: z.array(z.string()).openapi({
      description:
        "Assignees with no matching workspace member; their items stay unassigned with a note in the description.",
    }),
    errors: z
      .array(
        z.object({ line: z.number(), key: z.string(), message: z.string() }),
      )
      .openapi({ description: "Items that failed, at most 200." }),
    warnings: z.array(warningSchema),
  })
  .openapi("ExternalImportResult");
