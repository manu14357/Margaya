import { z } from "../openapi";
import { VALID_PRIORITIES } from "../task/validate-task-fields";

export const MAX_TEMPLATES_PER_PROJECT = 50;
export const MAX_TEMPLATE_SUBTASKS = 50;
export const MAX_TEMPLATE_REFERENCES = 20;

export const templateParam = z.object({ id: z.string() });

export const listTemplatesParam = z.object({ projectId: z.string() });

const idList = (description: string) =>
  z
    .array(z.string().min(1).max(128))
    .max(MAX_TEMPLATE_REFERENCES)
    .openapi({ description });

const templateFields = {
  name: z.string().trim().min(1).max(80).openapi({
    description: "Unique in the project, case-insensitively.",
  }),
  titlePattern: z.string().max(200).openapi({
    description:
      "The new task's title. `{title}` is replaced by the typed title; without it, a typed title is appended after a space.",
  }),
  description: z.string().max(100_000),
  columnId: z.string().min(1).nullable().openapi({
    description:
      "A column of this project (not the intake triage column), or null for the project's entry column.",
  }),
  priority: z.enum(VALID_PRIORITIES).nullable(),
  labelIds: idList("Workspace labels (not task copies) to put on the task."),
  assigneeIds: idList(
    "Workspace members to assign. Empty means the project's default assignee, if any.",
  ),
  estimatePointId: z.string().min(1).nullable().openapi({
    description:
      "A point of the project's active estimate system; ignored while estimates are off.",
  }),
  subtasks: z
    .array(z.string().trim().min(1).max(500))
    .max(MAX_TEMPLATE_SUBTASKS)
    .openapi({
      description:
        "Sub-task titles, created under the new task in this order (needs task:update to use).",
    }),
};

export const createTemplateBody = z
  .object({
    projectId: z.string().min(1),
    name: templateFields.name,
    titlePattern: templateFields.titlePattern.optional(),
    description: templateFields.description.optional(),
    columnId: templateFields.columnId.optional(),
    priority: templateFields.priority.optional(),
    labelIds: templateFields.labelIds.optional(),
    assigneeIds: templateFields.assigneeIds.optional(),
    estimatePointId: templateFields.estimatePointId.optional(),
    subtasks: templateFields.subtasks.optional(),
  })
  .strict()
  .openapi("CreateTaskTemplateBody");

export const updateTemplateBody = z
  .object({
    name: templateFields.name.optional(),
    titlePattern: templateFields.titlePattern.optional(),
    description: templateFields.description.optional(),
    columnId: templateFields.columnId.optional(),
    priority: templateFields.priority.optional(),
    labelIds: templateFields.labelIds.optional(),
    assigneeIds: templateFields.assigneeIds.optional(),
    estimatePointId: templateFields.estimatePointId.optional(),
    subtasks: templateFields.subtasks.optional(),
  })
  .strict()
  .openapi("UpdateTaskTemplateBody", {
    description: "Any subset of the template's fields.",
  });

export const applyTemplateBody = z
  .object({
    title: z.string().max(500).optional().openapi({
      description: "Typed title, merged into the title pattern.",
    }),
    status: z.string().min(1).optional().openapi({
      description:
        "A column slug that overrides the template's column, e.g. the column a quick add ran in.",
    }),
  })
  .strict()
  .openapi("ApplyTaskTemplateBody");

export type TemplateInput = z.infer<typeof updateTemplateBody>;
