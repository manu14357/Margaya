import { z } from "../openapi";
import { MARGAYA_PRIORITIES } from "./mapping";

const countedName = z.object({ name: z.string(), count: z.number() });

const warningSchema = z
  .object({
    message: z.string(),
    count: z.number().openapi({ description: "How many issues it affects." }),
  })
  .openapi("JiraImportWarning");

export const jiraPreviewSchema = z
  .object({
    issueCount: z.number(),
    columns: z.array(countedName).openapi({
      description:
        "Detected CSV columns; count is how many columns repeat the name (Labels, Comment, Sprint…).",
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
          .object({ id: z.string(), name: z.string(), email: z.string() })
          .nullable()
          .openapi({ description: "The matched workspace member, or null." }),
      }),
    ),
    issueTypes: z.array(countedName),
    sprints: z.array(countedName),
    components: z.array(countedName),
    totals: z.object({
      comments: z.number(),
      attachments: z.number(),
      subtasks: z.number(),
      links: z.number(),
      alreadyImported: z.number().openapi({
        description: "Issues whose key was imported into this project before.",
      }),
    }),
    features: z.object({
      cycles: z.boolean(),
      modules: z.boolean(),
      estimates: z.boolean().openapi({
        description:
          "Estimates are on and the active system takes Jira values (points or time).",
      }),
    }),
    permissions: z.object({
      update: z.boolean(),
      comments: z.boolean(),
      cycles: z.boolean(),
      modules: z.boolean(),
    }),
    warnings: z.array(warningSchema),
  })
  .openapi("JiraImportPreview");

export const jiraImportResultSchema = z
  .object({
    total: z.number(),
    created: z.number(),
    updated: z.number(),
    skipped: z.number().openapi({
      description: "Issues imported before and left as they are.",
    }),
    failed: z.number(),
    comments: z.number().openapi({ description: "Comments added." }),
    relations: z.number().openapi({
      description: "Sub-task and issue-link relations added.",
    }),
    unmatchedPeople: z.array(z.string()).openapi({
      description:
        "Assignees and reporters with no matching workspace member; their issues stay unassigned.",
    }),
    errors: z
      .array(
        z.object({ line: z.number(), key: z.string(), message: z.string() }),
      )
      .openapi({ description: "Rows that failed, at most 200." }),
    warnings: z.array(warningSchema),
  })
  .openapi("JiraImportResult");
