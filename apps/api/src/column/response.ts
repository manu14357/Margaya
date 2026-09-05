import { responseTimestamp, z } from "../openapi";
import { COLUMN_GROUPS } from "./groups";

export const columnGroupSchema = z.enum(COLUMN_GROUPS).openapi("ColumnGroup", {
  description:
    "What the column means: backlog, unstarted (not started), started, completed, cancelled, or triage (reserved for intake). Aggregations order groups in that sequence, with triage first.",
});

export const columnSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    slug: z.string().openapi({
      description:
        "Stable identifier derived from the name; tasks store this as their status.",
    }),
    position: z.number().openapi({
      description:
        "Board order, ascending. Columns are always returned sorted by it.",
    }),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    group: columnGroupSchema,
    isFinal: z.boolean().openapi({
      description:
        "True exactly when the group is completed or cancelled. Maintained by the API; it stops overdue reminders for tasks in the column.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Column");

export const columnListSchema = z.array(columnSchema);
