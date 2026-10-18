import { responseTimestamp, z } from "../openapi";

export const taskTemplateSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    titlePattern: z.string(),
    description: z.string(),
    columnId: z.string().nullable(),
    column: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .nullable(),
    priority: z.string().nullable(),
    labels: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string() }),
    ),
    assigneeIds: z.array(z.string()),
    estimatePointId: z.string().nullable(),
    subtasks: z.array(z.string()),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TaskTemplate", {
    description:
      "Defaults for a new task. References that went stale (a deleted label or column, a member who left, a point outside the active estimate system) are left out.",
  });

export const taskTemplateListSchema = z.array(taskTemplateSchema);

export const deletedTemplateSchema = z
  .object({ id: z.string() })
  .openapi("DeletedTaskTemplate");
