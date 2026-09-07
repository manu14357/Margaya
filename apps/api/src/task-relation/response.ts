import { responseTimestamp, z } from "../openapi";

const relationTypeDescription =
  "The stored type, source → target: `subtask` (source is the parent), `blocks` (source blocks target), `related`, `duplicate` (source is a duplicate of target), `start_before` (source starts before target) or `finish_before` (source finishes before target). Each task reads it from its own side: blocks is blocking for the source and blocked_by for the target, start_before becomes start_after and finish_before becomes finish_after for the target.";

export const relatedTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string().nullable(),
    number: z.number().nullable(),
    projectId: z.string(),
    projectSlug: z.string().openapi({
      description: "The task's own project key, for {projectSlug}-{number}.",
    }),
    projectName: z.string(),
    group: z.string().nullable().openapi({
      description:
        "The task's status group (backlog for planned tasks). Archived tasks keep their column's group.",
    }),
    userId: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee, or null." }),
    assigneeName: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's name." }),
    assigneeIds: z.array(z.string()).openapi({
      description: "Every assignee's user id, first assignee first.",
    }),
  })
  .openapi("RelatedTask");

export const taskRelationSchema = z
  .object({
    id: z.string(),
    sourceTaskId: z.string(),
    targetTaskId: z.string(),
    relationType: z.string().openapi({ description: relationTypeDescription }),
    createdAt: responseTimestamp,
  })
  .openapi("TaskRelation");

// Always present in practice: relations whose endpoints are not both visible in
// the workspace are dropped. Nullable only because the lookup is a map read.
export const taskRelationWithTasksSchema = taskRelationSchema
  .extend({
    sourceTask: relatedTaskSchema.nullable(),
    targetTask: relatedTaskSchema.nullable(),
  })
  .openapi("TaskRelationWithTasks");

export const taskRelationWithTasksListSchema = z.array(
  taskRelationWithTasksSchema,
);

export const taskParentResultSchema = z
  .object({
    taskId: z.string(),
    parent: relatedTaskSchema.nullable().openapi({
      description: "The task's parent after the change, or null.",
    }),
  })
  .openapi("TaskParentResult");

export const projectDependencySchema = z
  .object({
    id: z.string(),
    sourceTaskId: z.string(),
    targetTaskId: z.string(),
    relationType: z.enum(["blocks", "start_before", "finish_before"]).openapi({
      description:
        "`blocks` (source must finish before target starts), `start_before` (source starts before target) or `finish_before` (source finishes before target).",
    }),
  })
  .openapi("ProjectDependency");

export const projectDependenciesSchema = z
  .object({
    relations: z.array(projectDependencySchema),
    truncated: z.boolean().openapi({
      description:
        "True when the project holds more dependencies than one response carries; the oldest are returned.",
    }),
  })
  .openapi("ProjectDependencies");
