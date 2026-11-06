import { z } from "../openapi";

export const projectIdParam = z.object({
  projectId: z.string(),
});

export const taskIdParam = z.object({
  taskId: z.string(),
});

export const customFieldIdParam = z.object({
  id: z.string(),
});

export const createCustomFieldBody = z.object({
  projectId: z.string(),
  name: z.string(),
  type: z.enum(["text", "number", "date", "dropdown", "boolean"]),
  required: z.boolean().optional().default(false),
  defaultValue: z.string().optional(),
  options: z.array(z.string()).optional(),
});

const OPTION_MAX_LENGTH = 128;

export const updateCustomFieldBody = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  options: z
    .array(z.string().max(OPTION_MAX_LENGTH))
    .min(1)
    .max(200)
    .optional()
    .openapi({
      description:
        "Dropdown fields: the full new list, in display order. An option left out without a rename is removed: tasks keep the value until someone changes it, lists still group and sort by it, and it can't be newly set. Filter menus stop offering it, while a filter already set on it keeps matching.",
    }),
  renamedOptions: z
    .array(
      z.object({
        from: z.string().max(OPTION_MAX_LENGTH),
        to: z.string().max(OPTION_MAX_LENGTH),
      }),
    )
    .max(200)
    .optional()
    .openapi({
      description:
        "Renames applied with options: tasks, the default value, saved view filters, automation conditions and drafts move to the new text. A rename to another listed option merges the two.",
    }),
  defaultValue: z.string().nullable().optional().openapi({
    description:
      "The value new tasks start with; null clears it. It must be valid for the field and stay one of the options, and a required field must keep one. It never changes existing tasks.",
  }),
});

export const reorderCustomFieldsBody = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      position: z.number(),
    }),
  ),
});

export const setCustomFieldValueBody = z.object({
  taskId: z.string(),
  fieldId: z.string(),
  value: z.string(),
});

export const bulkSetCustomFieldValueBody = z.object({
  taskIds: z.array(z.string()).min(1).max(5000),
  fieldId: z.string(),
  value: z.string().openapi({
    description: "The new value on every task; an empty string clears it.",
  }),
});
