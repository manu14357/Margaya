import { z } from "../openapi";
import { ESTIMATE_TYPES } from "./types";
import {
  MAX_ESTIMATE_NAME_LENGTH,
  MAX_ESTIMATE_POINTS,
} from "./validate-points";

export const MAX_TOTALS_TASK_IDS = 5000;

export const projectIdParam = z.object({ projectId: z.string() });

export const estimateParam = z.object({
  projectId: z.string(),
  estimateId: z.string(),
});

export const pointParam = z.object({
  projectId: z.string(),
  estimateId: z.string(),
  pointId: z.string(),
});

export const taskParam = z.object({ id: z.string() });

const estimateName = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ESTIMATE_NAME_LENGTH)
  .openapi({
    description:
      "1 to 60 characters after trimming; unique in the project, ignoring case.",
  });

// Zod only bounds the payload size. The value rules (section "values" of the
// create route) answer 400 with a per-value error code instead.
const rawValue = z.string().max(200).openapi({
  description:
    "Points: a number above 0, at most 999, with at most 2 decimals. Time: whole minutes above 0, at most 60000. Categories: text that is not a number. At most 20 characters after trimming.",
});

export const createEstimateBody = z.object({
  name: estimateName,
  type: z.enum(ESTIMATE_TYPES).openapi({
    description: "Fixed for the life of the system.",
  }),
  values: z.array(rawValue).max(100).openapi({
    description:
      "2 to 10 distinct values. Points and time are stored in ascending order; categories keep the order given.",
  }),
});

export const updateEstimateBody = z.object({ name: estimateName });

export const activateEstimateBody = z.object({
  mapping: z
    .array(
      z
        .object({
          fromPointId: z.string().openapi({
            description: "A value of the currently active system.",
          }),
          toPointId: z.string().nullable().openapi({
            description:
              "A value of the system being activated, or null for no estimate.",
          }),
        })
        .openapi("EstimatePointMapping"),
    )
    .max(MAX_ESTIMATE_POINTS)
    .openapi({
      description:
        "Where the tasks on each value of the active system go. Unmapped values leave their tasks without an estimate. Must be empty when no system is active.",
    }),
});

export const createPointBody = z.object({
  value: rawValue,
  position: z.number().int().min(1).optional().openapi({
    description:
      "1-based position for a category (clamped to the ends); appended when omitted. Ignored for points and time, which stay sorted by value.",
  }),
});

export const updatePointBody = z.object({ value: rawValue });

export const deletePointQuery = z.object({
  replacementPointId: z.string().optional().openapi({
    description: "Another value of the same system to move the tasks to.",
  }),
  clear: z.enum(["true", "false"]).optional().openapi({
    description:
      "true leaves the tasks on this value without an estimate. Exclusive with replacementPointId.",
  }),
});

export const reorderPointsBody = z.object({
  pointIds: z.array(z.string()).min(1).max(MAX_ESTIMATE_POINTS).openapi({
    description: "Every value of the system, exactly once, in the new order.",
  }),
});

export const totalsBody = z.object({
  taskIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_TOTALS_TASK_IDS)
    .openapi({
      description:
        "1 to 5000 task ids. Ids that are not visible tasks of the project are ignored.",
    }),
});

export const taskEstimateBody = z.object({
  estimatePointId: z.string().nullable().openapi({
    description:
      "A value of the project's active estimate system, or null to clear the estimate.",
  }),
});
