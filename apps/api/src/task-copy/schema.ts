import { z } from "../openapi";
import { COPY_OPTION_KEYS } from "./copy-plan";

export const taskIdParam = z.object({ taskId: z.string() });

export const copyTaskBody = z.object({
  projectId: z.string().max(64).optional().openapi({
    description:
      "A non-archived project of the same workspace. Defaults to the task's own project.",
  }),
  title: z.string().max(1000).optional().openapi({
    description: 'Trimmed; defaults to "{title} (copy)".',
  }),
  include: z
    .array(z.enum(COPY_OPTION_KEYS))
    .max(COPY_OPTION_KEYS.length)
    .optional()
    .openapi({
      description:
        "What comes along besides the title, status and priority, which are always copied. Defaults to description, assignees, labels, dates, customFields, parent and planning; links and attachments are opt-in. Custom field values, the parent and planning (cycle, modules, estimate) are only copied inside the same project. Required custom field values are always copied.",
    }),
});
