import { z } from "../openapi";
import { COLUMN_GROUPS, CREATABLE_COLUMN_GROUPS } from "./groups";

export const projectIdParam = z.object({ projectId: z.string() });

export const columnParam = z.object({ id: z.string() });

export const getColumnsQuery = z.object({
  includeTriage: z.enum(["true", "false"]).optional().openapi({
    description:
      'Pass "true" to include triage columns, which intake manages and boards hide.',
  }),
});

// `triage` passes the enum so the controller can answer with its dedicated
// message; the documented values are the five the API accepts.
const columnGroupInput = z
  .enum(COLUMN_GROUPS)
  .optional()
  .openapi({
    enum: [...CREATABLE_COLUMN_GROUPS],
    description:
      "The column's group. Closed groups (completed, cancelled) set isFinal. The triage group is reserved for intake and rejected.",
  });

const isFinalInput = z.boolean().optional().openapi({
  description:
    "Legacy shortcut for the group. It must agree with group when both are sent.",
});

export const createColumnBody = z.object({
  name: z.string(),
  icon: z.string().optional(),
  color: z.string().optional(),
  group: columnGroupInput,
  isFinal: isFinalInput,
});

export const updateColumnBody = z.object({
  name: z.string().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  group: columnGroupInput,
  isFinal: isFinalInput,
});

export const reorderColumnsBody = z.object({
  columns: z.array(z.object({ id: z.string(), position: z.number() })).openapi({
    description:
      "Every column keeps its new position. Columns from another project are rejected.",
  }),
});
