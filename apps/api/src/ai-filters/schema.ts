import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";
import { filterNodeSchema } from "../task-query/schema";

// Request and response schemas of the natural-language filter route.

export const parseFilterBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({
      description: "The workspace whose tasks are filtered.",
    }),
    projectId: z.string().min(1).optional().openapi({
      description:
        "The project in view. Without it the filter is for the whole workspace (no status or module, which need one project).",
    }),
    text: z.string().trim().min(2).max(300).openapi({
      description:
        'What to show, in the caller\'s words, e.g. "my overdue bugs".',
    }),
    locale: answerLocale,
  })
  .openapi("AiParseFilterInput");

export const parsedFilterSchema = z
  .object({
    filters: filterNodeSchema.nullable().openapi({
      description:
        "A flat and/or group of conditions (one per key) ready for POST /task-query, or null when nothing could be understood.",
    }),
    dropped: z.array(z.string()).openapi({
      description:
        "Words or values that matched nothing the caller can filter on (at most 10), to show as not understood.",
    }),
  })
  .openapi("AiParsedFilter");
