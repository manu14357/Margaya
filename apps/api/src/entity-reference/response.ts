import { z } from "../openapi";
import { PROJECT_FEATURE_KEYS } from "../project/features";
import { RECENT_VISIT_ENTITY_TYPES } from "./types";

export const entitySummarySchema = z
  .object({
    type: z.enum(RECENT_VISIT_ENTITY_TYPES),
    id: z.string(),
    name: z.string().openapi({
      description: "Project name, task title, cycle name, and so on.",
    }),
    key: z.string().nullable().openapi({
      description:
        'Task: the project key and number, e.g. "web-12" (display it uppercased). Project: its key. Others: null.',
    }),
    icon: z.string().nullable(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    isArchived: z.boolean().openapi({
      description: "The entity or its project is archived.",
    }),
    feature: z.enum(PROJECT_FEATURE_KEYS).nullable().openapi({
      description:
        "The project feature that gates the entity (cycles, modules, views, pages), or null.",
    }),
    details: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "Type-specific extras. Task: group, priority, assigneeId (the first assignee), assigneeIds (every assignee, first first) and status.",
    }),
  })
  .openapi("EntitySummary");
