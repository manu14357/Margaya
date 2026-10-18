import { responseTimestamp, z } from "../openapi";

export const searchSnippetSchema = z
  .object({
    text: z.string().openapi({
      description:
        "Plain text around the best matches: up to two fragments joined by ` … `.",
    }),
    highlights: z
      .array(
        z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        }),
      )
      .openapi({
        description:
          "Matched spans of `text`, as [start, end) offsets in UTF-16 code units (JavaScript string indices).",
      }),
  })
  .openapi("SearchSnippet");

export const searchResultSchema = z
  .object({
    id: z.string(),
    type: z.enum([
      "task",
      "project",
      "workspace",
      "comment",
      "activity",
      "page",
      "cycle",
      "module",
      "view",
      "intake",
    ]),
    title: z.string(),
    description: z.string().optional(),
    content: z.string().optional().openapi({
      description:
        "Matched body text, for comment and activity results. Activities get a rendered summary such as `changed status from Todo to In Progress`. Pages get a snippet of about 160 characters around the first match.",
    }),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    projectSlug: z.string().optional(),
    workspaceId: z.string().optional(),
    workspaceName: z.string().optional(),
    userId: z.string().optional(),
    userName: z.string().optional(),
    createdAt: responseTimestamp,
    relevanceScore: z.number().openapi({
      description:
        "Higher is a better match: 10 for an exact task key (WEB-12), 3 when the whole query matches the title, 2 for a body match, each plus a full-text rank below 1. Results are sorted by score, then by createdAt descending.",
    }),
    taskNumber: z.number().optional().openapi({
      description:
        "For task, comment, activity and intake results: the number in the task key.",
    }),
    taskId: z.string().optional().openapi({
      description: "For comment and activity results: the task they belong to.",
    }),
    snippet: searchSnippetSchema.optional().openapi({
      description:
        "For task, comment and page results: highlighted body text around the match.",
    }),
    priority: z.string().optional(),
    status: z.string().optional().openapi({
      description:
        "A task's column slug, a module's status, or an intake request's effective status.",
    }),
  })
  .openapi("SearchResult");

export const searchResponseSchema = z
  .object({
    results: z.array(searchResultSchema),
    totalCount: z.number().openapi({
      description:
        "Total matches found before the `limit` slice, so a caller can tell that more exist.",
    }),
    searchQuery: z.string().openapi({ description: "The query that was run." }),
  })
  .openapi("SearchResponse");
